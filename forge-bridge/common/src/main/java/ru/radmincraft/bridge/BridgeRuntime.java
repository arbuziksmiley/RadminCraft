package ru.radmincraft.bridge;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Deque;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

public final class BridgeRuntime {
    public static final int PROTOCOL_MAJOR = 1;
    public static final int PROTOCOL_MINOR = 1;
    private static final int MAX_EVENTS = 1000;
    private static final int MAX_PROCESSED = 1000;
    private static final Gson GSON = new Gson();

    public interface ServerSnapshot {
        JsonObject heartbeat();
    }

    public interface CommandExecutor {
        boolean execute(String type, JsonObject payload);
    }

    private static final class Event {
        final String path;
        final JsonObject body;
        Event(String path, JsonObject body) { this.path = path; this.body = body; }
    }

    private final String endpoint;
    private final String serverId;
    private final ServerSnapshot snapshot;
    private final CommandExecutor commandExecutor;
    private final File processedFile;
    private final Deque<Event> events = new ArrayDeque<Event>();
    private final Set<String> processed = new LinkedHashSet<String>();
    private final AtomicBoolean running = new AtomicBoolean();
    private ScheduledExecutorService worker;
    private long lastHeartbeat;
    private long lastPoll;
    private long retryAfter;
    private int failures;

    public BridgeRuntime(String endpoint, String serverId, ServerSnapshot snapshot, CommandExecutor commandExecutor, File processedFile) {
        this.endpoint = endpoint == null ? "http://127.0.0.1:18483" : endpoint.replaceAll("/+$", "");
        this.serverId = safe(serverId, 80);
        this.snapshot = snapshot;
        this.commandExecutor = commandExecutor;
        this.processedFile = processedFile;
        loadProcessed();
    }

    public synchronized void chat(String playerId, String player, String text) {
        JsonObject body = baseEvent();
        body.addProperty("playerId", safe(playerId, 80));
        body.addProperty("player", safe(player, 16));
        body.addProperty("text", safe(text, 600));
        offer(new Event("/api/bridge/chat", body));
    }

    public synchronized void player(String id, String name, boolean inGame, double x, double z, String dimension) {
        JsonObject body = baseEvent();
        body.addProperty("id", safe(id, 80));
        body.addProperty("name", safe(name, 16));
        body.addProperty("inGame", inGame);
        body.addProperty("x", x);
        body.addProperty("z", z);
        body.addProperty("dimension", safe(dimension, 80));
        offer(new Event("/api/bridge/player-status", body));
    }

    public void start() {
        if (!running.compareAndSet(false, true)) return;
        worker = Executors.newSingleThreadScheduledExecutor(new ThreadFactory() {
            public Thread newThread(Runnable runnable) {
                Thread thread = new Thread(runnable, "RadminCraft-Bridge");
                thread.setDaemon(true);
                return thread;
            }
        });
        worker.scheduleWithFixedDelay(new Runnable() {
            public void run() { tick(); }
        }, 0, 250, TimeUnit.MILLISECONDS);
    }

    public void stop() {
        running.set(false);
        if (worker != null) worker.shutdownNow();
    }

    private void tick() {
        if (!running.get() || System.currentTimeMillis() < retryAfter) return;
        try {
            long now = System.currentTimeMillis();
            if (now - lastHeartbeat >= 5000) {
                JsonObject heartbeat = snapshot.heartbeat();
                heartbeat.addProperty("protocolMajor", PROTOCOL_MAJOR);
                heartbeat.addProperty("protocolMinor", PROTOCOL_MINOR);
                heartbeat.addProperty("serverId", serverId);
                request("POST", "/api/bridge/heartbeat", heartbeat);
                lastHeartbeat = now;
            }
            Event event;
            synchronized (this) { event = events.peekFirst(); }
            if (event != null) {
                request("POST", event.path, event.body);
                synchronized (this) { if (events.peekFirst() == event) events.removeFirst(); }
            }
            if (now - lastPoll >= 1000) {
                pollCommands();
                lastPoll = now;
            }
            failures = 0;
        } catch (Exception ignored) {
            failures = Math.min(failures + 1, 8);
            long base = Math.min(30000L, 500L << Math.min(failures, 6));
            retryAfter = System.currentTimeMillis() + base + (long) (Math.random() * 300L);
        }
    }

    private void pollCommands() throws Exception {
        JsonObject response = request("GET", "/api/bridge/commands?limit=50&serverId=" + serverId, null);
        JsonArray commands = response.has("commands") ? response.getAsJsonArray("commands") : new JsonArray();
        List<String> acknowledged = new ArrayList<String>();
        for (JsonElement element : commands) {
            if (!element.isJsonObject()) continue;
            JsonObject command = element.getAsJsonObject();
            String id = string(command, "id");
            String type = string(command, "type");
            if (id.length() == 0 || type.length() == 0) continue;
            if (processed.contains(id)) { acknowledged.add(id); continue; }
            JsonObject payload = command.has("payload") && command.get("payload").isJsonObject()
                ? command.getAsJsonObject("payload") : new JsonObject();
            if (commandExecutor.execute(type, payload)) {
                remember(id);
                acknowledged.add(id);
            }
        }
        if (!acknowledged.isEmpty()) {
            JsonObject ack = new JsonObject();
            ack.addProperty("serverId", serverId);
            ack.add("ids", GSON.toJsonTree(acknowledged));
            request("POST", "/api/bridge/ack", ack);
        }
    }

    private JsonObject request(String method, String path, JsonObject body) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(endpoint + path).openConnection();
        connection.setConnectTimeout(1500);
        connection.setReadTimeout(2500);
        connection.setRequestMethod(method);
        connection.setRequestProperty("Accept", "application/json");
        if (body != null) {
            byte[] bytes = GSON.toJson(body).getBytes(StandardCharsets.UTF_8);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setFixedLengthStreamingMode(bytes.length);
            OutputStream output = connection.getOutputStream();
            output.write(bytes);
            output.close();
        }
        int status = connection.getResponseCode();
        InputStream stream = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
        String json = read(stream);
        connection.disconnect();
        if (status < 200 || status >= 300) throw new IllegalStateException("HTTP " + status);
        return json.length() == 0 ? new JsonObject() : GSON.fromJson(json, JsonObject.class);
    }

    private synchronized void offer(Event event) {
        while (events.size() >= MAX_EVENTS) events.removeFirst();
        events.addLast(event);
    }

    private JsonObject baseEvent() {
        JsonObject body = new JsonObject();
        body.addProperty("eventId", UUID.randomUUID().toString());
        body.addProperty("serverId", serverId);
        body.addProperty("createdAt", System.currentTimeMillis());
        return body;
    }

    private synchronized void remember(String id) {
        processed.add(id);
        while (processed.size() > MAX_PROCESSED) processed.remove(processed.iterator().next());
        saveProcessed();
    }

    private void loadProcessed() {
        if (processedFile == null || !processedFile.isFile()) return;
        try {
            List<String> lines = Files.readAllLines(processedFile.toPath(), StandardCharsets.UTF_8);
            for (String line : lines) if (!line.trim().isEmpty()) processed.add(line.trim());
        } catch (Exception ignored) {}
    }

    private void saveProcessed() {
        if (processedFile == null) return;
        try {
            File parent = processedFile.getParentFile();
            if (parent != null) parent.mkdirs();
            Files.write(processedFile.toPath(), processed, StandardCharsets.UTF_8);
        } catch (Exception ignored) {}
    }

    private static String string(JsonObject object, String key) {
        return object.has(key) && !object.get(key).isJsonNull() ? object.get(key).getAsString() : "";
    }

    private static String safe(String value, int max) {
        String clean = value == null ? "" : value.replace("\u0000", "");
        return clean.length() <= max ? clean : clean.substring(0, max);
    }

    public static String identifyServer(Object server, File gameDirectory) {
        String worldName = "";
        try {
            Object worldData = server.getClass().getMethod("getWorldData").invoke(server);
            if (worldData != null) {
                try { worldName = String.valueOf(worldData.getClass().getMethod("getLevelName").invoke(worldData)); }
                catch (Exception ignored) {}
            }
        } catch (Exception ignored) {}
        if (worldName.length() == 0) {
            for (String method : new String[] { "getFolderName", "getWorldName" }) {
                try {
                    worldName = String.valueOf(server.getClass().getMethod(method).invoke(server));
                    if (worldName.length() > 0) break;
                } catch (Exception ignored) {}
            }
        }
        String root;
        try { root = (gameDirectory == null ? new File(".") : gameDirectory).getCanonicalPath(); }
        catch (Exception ignored) { root = (gameDirectory == null ? new File(".") : gameDirectory).getAbsolutePath(); }
        return UUID.nameUUIDFromBytes((root + "|" + worldName).getBytes(StandardCharsets.UTF_8)).toString();
    }

    private static String read(InputStream stream) throws Exception {
        if (stream == null) return "";
        BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8));
        StringBuilder result = new StringBuilder();
        char[] buffer = new char[2048];
        int count;
        while ((count = reader.read(buffer)) >= 0) {
            result.append(buffer, 0, count);
            if (result.length() > 1024 * 1024) throw new IllegalStateException("Response too large");
        }
        reader.close();
        return result.toString();
    }
}

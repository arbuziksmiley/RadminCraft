package ru.radmincraft.bridge.forge1182;

import com.google.gson.JsonObject;
import net.minecraft.SharedConstants;
import net.minecraft.Util;
import net.minecraft.network.chat.ChatType;
import net.minecraft.network.chat.TextComponent;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.event.ServerChatEvent;
import net.minecraftforge.event.TickEvent;
import net.minecraftforge.event.entity.player.PlayerEvent;
import net.minecraftforge.event.server.ServerStartedEvent;
import net.minecraftforge.event.server.ServerStoppingEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.ModList;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.loading.FMLPaths;
import ru.radmincraft.bridge.BridgeRuntime;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.Queue;
import java.util.UUID;
import java.util.concurrent.ConcurrentLinkedQueue;

@Mod(RadminCraftBridge.MOD_ID)
public final class RadminCraftBridge {
    public static final String MOD_ID = "radmincraft_bridge";
    public static final String VERSION = "1.1.0";
    private final Queue<Runnable> serverTasks = new ConcurrentLinkedQueue<Runnable>();
    private volatile MinecraftServer server;
    private volatile int playerCount;
    private volatile long ticks;
    private BridgeRuntime bridge;

    public RadminCraftBridge() {
        MinecraftForge.EVENT_BUS.register(this);
    }

    @SubscribeEvent
    public void onServerStarted(ServerStartedEvent event) {
        server = event.getServer();
        playerCount = server.getPlayerCount();
        File processed = FMLPaths.CONFIGDIR.get().resolve("radmincraft-bridge-processed.txt").toFile();
        String serverId = BridgeRuntime.identifyServer(server, FMLPaths.GAMEDIR.get().toFile());
        bridge = new BridgeRuntime("http://127.0.0.1:18483", serverId, this::heartbeat, this::execute, processed);
        bridge.start();
        for (ServerPlayer player : server.getPlayerList().getPlayers()) sendPlayer(player, true);
    }

    @SubscribeEvent
    public void onServerStopping(ServerStoppingEvent event) {
        if (bridge != null) {
            for (ServerPlayer player : event.getServer().getPlayerList().getPlayers()) sendPlayer(player, false);
            bridge.stop();
        }
        bridge = null;
        server = null;
        serverTasks.clear();
    }

    @SubscribeEvent
    public void onLogin(PlayerEvent.PlayerLoggedInEvent event) {
        if (event.getPlayer() instanceof ServerPlayer) sendPlayer((ServerPlayer) event.getPlayer(), true);
    }

    @SubscribeEvent
    public void onLogout(PlayerEvent.PlayerLoggedOutEvent event) {
        if (event.getPlayer() instanceof ServerPlayer) sendPlayer((ServerPlayer) event.getPlayer(), false);
    }

    @SubscribeEvent
    public void onChat(ServerChatEvent event) {
        if (bridge == null) return;
        ServerPlayer player = event.getPlayer();
        bridge.chat(player.getUUID().toString(), player.getGameProfile().getName(), event.getMessage());
    }

    @SubscribeEvent
    public void onServerTick(TickEvent.ServerTickEvent event) {
        if (event.phase != TickEvent.Phase.END || server == null) return;
        Runnable task;
        while ((task = serverTasks.poll()) != null) task.run();
        playerCount = server.getPlayerCount();
        if (++ticks % 100 == 0 && bridge != null) {
            for (ServerPlayer player : server.getPlayerList().getPlayers()) sendPlayer(player, true);
        }
    }

    private JsonObject heartbeat() {
        JsonObject body = new JsonObject();
        body.addProperty("bridgeVersion", VERSION);
        body.addProperty("minecraftVersion", SharedConstants.getCurrentVersion().getName());
        body.addProperty("forgeVersion", ModList.get().getModContainerById("forge").map(container -> container.getModInfo().getVersion().toString()).orElse(""));
        body.addProperty("serverKind", server != null && server.isDedicatedServer() ? "dedicated" : "integrated");
        body.addProperty("serverId", UUID.nameUUIDFromBytes("radmincraft-local-server".getBytes(StandardCharsets.UTF_8)).toString());
        body.addProperty("players", playerCount);
        return body;
    }

    private boolean execute(String type, JsonObject payload) {
        if (!"chat.broadcast".equals(type) || server == null) return false;
        String author = sanitize(payload.has("author") ? payload.get("author").getAsString() : "", 20);
        String text = sanitize(payload.has("text") ? payload.get("text").getAsString() : "", 600);
        if (author.isEmpty() || text.isEmpty()) return false;
        serverTasks.offer(() -> server.getPlayerList().broadcastMessage(
            new TextComponent("[RadminCraft] " + author + ": " + text), ChatType.SYSTEM, Util.NIL_UUID));
        return true;
    }

    private void sendPlayer(ServerPlayer player, boolean online) {
        BridgeRuntime active = bridge;
        if (active == null || player == null) return;
        active.player(player.getUUID().toString(), player.getGameProfile().getName(), online,
            player.getX(), player.getZ(), player.level.dimension().location().toString());
    }

    private static String sanitize(String value, int max) {
        String clean = value == null ? "" : value.replaceAll("[\\p{Cntrl}&&[^\n\t]]", "").replace('\u00A7', ' ');
        return clean.length() <= max ? clean : clean.substring(0, max);
    }
}

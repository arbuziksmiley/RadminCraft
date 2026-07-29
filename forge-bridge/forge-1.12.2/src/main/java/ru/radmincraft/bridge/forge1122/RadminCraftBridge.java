package ru.radmincraft.bridge.forge1122;

import com.google.gson.JsonObject;
import net.minecraft.entity.player.EntityPlayerMP;
import net.minecraft.server.MinecraftServer;
import net.minecraft.util.text.TextComponentString;
import net.minecraftforge.common.ForgeVersion;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.event.ServerChatEvent;
import net.minecraftforge.fml.common.Loader;
import net.minecraftforge.fml.common.FMLCommonHandler;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.common.event.FMLServerStartedEvent;
import net.minecraftforge.fml.common.event.FMLServerStoppingEvent;
import net.minecraftforge.fml.common.eventhandler.SubscribeEvent;
import net.minecraftforge.fml.common.gameevent.PlayerEvent;
import net.minecraftforge.fml.common.gameevent.TickEvent;
import ru.radmincraft.bridge.BridgeRuntime;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.Queue;
import java.util.UUID;
import java.util.concurrent.ConcurrentLinkedQueue;

@Mod(modid = RadminCraftBridge.MOD_ID, name = RadminCraftBridge.NAME, version = RadminCraftBridge.VERSION, acceptableRemoteVersions = "*")
public final class RadminCraftBridge {
    public static final String MOD_ID = "radmincraft_bridge";
    public static final String NAME = "RadminCraft Bridge";
    public static final String VERSION = "1.1.0";
    private final Queue<Runnable> serverTasks = new ConcurrentLinkedQueue<Runnable>();
    private volatile MinecraftServer server;
    private volatile int playerCount;
    private volatile long ticks;
    private BridgeRuntime bridge;

    public RadminCraftBridge() {
        MinecraftForge.EVENT_BUS.register(this);
    }

    @Mod.EventHandler
    public void onServerStarted(FMLServerStartedEvent event) {
        server = FMLCommonHandler.instance().getMinecraftServerInstance();
        playerCount = server.getCurrentPlayerCount();
        File processed = new File(Loader.instance().getConfigDir(), "radmincraft-bridge-processed.txt");
        String serverId = BridgeRuntime.identifyServer(server, Loader.instance().getConfigDir().getParentFile());
        bridge = new BridgeRuntime("http://127.0.0.1:18483", serverId, this::heartbeat, this::execute, processed);
        bridge.start();
        for (EntityPlayerMP player : server.getPlayerList().getPlayers()) sendPlayer(player, true);
    }

    @Mod.EventHandler
    public void onServerStopping(FMLServerStoppingEvent event) {
        if (bridge != null && server != null) {
            for (EntityPlayerMP player : server.getPlayerList().getPlayers()) sendPlayer(player, false);
            bridge.stop();
        }
        bridge = null;
        server = null;
        serverTasks.clear();
    }

    @SubscribeEvent
    public void onLogin(PlayerEvent.PlayerLoggedInEvent event) {
        if (event.player instanceof EntityPlayerMP) sendPlayer((EntityPlayerMP) event.player, true);
    }

    @SubscribeEvent
    public void onLogout(PlayerEvent.PlayerLoggedOutEvent event) {
        if (event.player instanceof EntityPlayerMP) sendPlayer((EntityPlayerMP) event.player, false);
    }

    @SubscribeEvent
    public void onChat(ServerChatEvent event) {
        if (bridge == null) return;
        EntityPlayerMP player = event.getPlayer();
        bridge.chat(player.getUniqueID().toString(), player.getName(), event.getMessage());
    }

    @SubscribeEvent
    public void onServerTick(TickEvent.ServerTickEvent event) {
        if (event.phase != TickEvent.Phase.END || server == null) return;
        Runnable task;
        while ((task = serverTasks.poll()) != null) task.run();
        playerCount = server.getCurrentPlayerCount();
        if (++ticks % 100 == 0 && bridge != null) {
            for (EntityPlayerMP player : server.getPlayerList().getPlayers()) sendPlayer(player, true);
        }
    }

    private JsonObject heartbeat() {
        JsonObject body = new JsonObject();
        body.addProperty("bridgeVersion", VERSION);
        body.addProperty("minecraftVersion", ForgeVersion.mcVersion);
        body.addProperty("forgeVersion", ForgeVersion.getVersion());
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
        serverTasks.offer(() -> server.getPlayerList().sendMessage(new TextComponentString("[RadminCraft] " + author + ": " + text)));
        return true;
    }

    private void sendPlayer(EntityPlayerMP player, boolean online) {
        BridgeRuntime active = bridge;
        if (active == null || player == null) return;
        active.player(player.getUniqueID().toString(), player.getName(), online,
            player.posX, player.posZ, Integer.toString(player.dimension));
    }

    private static String sanitize(String value, int max) {
        String clean = value == null ? "" : value.replaceAll("[\\p{Cntrl}&&[^\n\t]]", "").replace('\u00A7', ' ');
        return clean.length() <= max ? clean : clean.substring(0, max);
    }
}

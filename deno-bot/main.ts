// FieldLogic Telegram Bot - Deno Deploy
// Handles account linking and fault notifications

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_KEY")!;

// Simple Supabase client functions (no external deps)
async function supabaseQuery(table: string, method: string, options: any = {}) {
  let url = `${SUPABASE_URL}/rest/v1/${table}`;
  const headers: Record<string, string> = {
    "apikey": SUPABASE_SERVICE_KEY,
    "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
    "Prefer": method === "POST" ? "return=minimal" : "return=representation",
  };

  if (options.select) {
    url += `?select=${options.select}`;
  }
  if (options.eq) {
    for (const [key, value] of Object.entries(options.eq)) {
      url += `${url.includes('?') ? '&' : '?'}${key}=eq.${value}`;
    }
  }
  if (options.gt) {
    for (const [key, value] of Object.entries(options.gt)) {
      url += `${url.includes('?') ? '&' : '?'}${key}=gt.${value}`;
    }
  }

  const fetchOptions: RequestInit = { method, headers };
  if (options.body) {
    fetchOptions.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, fetchOptions);
  if (!response.ok && method !== "DELETE") {
    console.error("Supabase error:", await response.text());
    return null;
  }

  if (method === "DELETE" || response.status === 204) return true;

  const data = await response.json();
  return Array.isArray(data) && options.single ? data[0] : data;
}

// Send Telegram message
async function sendTelegram(chatId: string | number, text: string) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
}

// Handle incoming Telegram webhook
async function handleTelegramWebhook(update: any): Promise<Response> {
  if (!update.message) return new Response("OK");

  const message = update.message;
  const chatId = message.chat.id;
  const text = message.text || "";
  const username = message.from?.username || null;
  const firstName = message.from?.first_name || "User";

  // Handle /start command
  if (text.startsWith("/start")) {
    const parts = text.split(" ");

    if (parts.length < 2) {
      await sendTelegram(chatId,
        `Welcome to FieldLogic Alerts! 🔔\n\n` +
        `To link your account:\n` +
        `1. Go to Settings in the FieldLogic portal\n` +
        `2. Click "Link Telegram Account"\n` +
        `3. Send the code here as: /start CODE`
      );
      return new Response("OK");
    }

    const code = parts[1].toUpperCase();
    console.log("Looking up code:", code);

    // Look up the code
    const linkCode = await supabaseQuery("telegram_link_codes", "GET", {
      select: "*",
      eq: { code, used: false },
      gt: { expires_at: new Date().toISOString() },
      single: true,
    });

    if (!linkCode) {
      await sendTelegram(chatId,
        `❌ Invalid or expired code.\n\nPlease generate a new code from the FieldLogic Settings page.`
      );
      return new Response("OK");
    }

    // Mark code as used
    await fetch(`${SUPABASE_URL}/rest/v1/telegram_link_codes?id=eq.${linkCode.id}`, {
      method: "PATCH",
      headers: {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ used: true }),
    });

    // Update user profile
    const updateResult = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?id=eq.${linkCode.user_id}`, {
      method: "PATCH",
      headers: {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        telegram_chat_id: chatId.toString(),
        telegram_username: username ? `@${username}` : firstName,
        telegram_verified: true,
        telegram_linked_at: new Date().toISOString(),
      }),
    });

    if (!updateResult.ok) {
      await sendTelegram(chatId, `❌ Error linking account. Please try again.`);
      return new Response("OK");
    }

    await sendTelegram(chatId,
      `✅ <b>Account linked successfully!</b>\n\n` +
      `You will now receive alerts when your devices enter fault state.\n\n` +
      `Go back to the FieldLogic Settings page and click "I've Sent the Code" to complete setup.`
    );
    return new Response("OK");
  }

  // Handle /status command
  if (text === "/status") {
    const profile = await supabaseQuery("user_profiles", "GET", {
      select: "email,telegram_verified",
      eq: { telegram_chat_id: chatId.toString() },
      single: true,
    });

    if (profile?.telegram_verified) {
      await sendTelegram(chatId,
        `✅ <b>Account linked</b>\n\nEmail: ${profile.email}\nYou will receive fault alerts for your devices.`
      );
    } else {
      await sendTelegram(chatId,
        `❌ No account linked to this chat.\n\nGo to FieldLogic Settings to link your account.`
      );
    }
    return new Response("OK");
  }

  // Handle /help command
  if (text === "/help") {
    await sendTelegram(chatId,
      `<b>FieldLogic Alerts Bot</b>\n\n` +
      `Commands:\n` +
      `/start CODE - Link your FieldLogic account\n` +
      `/status - Check your link status\n` +
      `/help - Show this help message\n\n` +
      `Visit fieldlogic.co.za for more info.`
    );
    return new Response("OK");
  }

  await sendTelegram(chatId, `I don't understand that command.\nSend /help to see available commands.`);
  return new Response("OK");
}

// Handle notification from ESP32 device (only needs device_id)
async function handleDeviceFault(data: any): Promise<Response> {
  const { device_id } = data;

  if (!device_id) {
    return Response.json({ success: false, error: "Missing device_id" });
  }

  console.log("Fault notification for device:", device_id);

  // Look up all users who have this device registered
  const deviceRecords = await supabaseQuery("devices", "GET", {
    select: "user_id,name",
    eq: { device_id },
  });

  if (!deviceRecords || deviceRecords.length === 0) {
    return Response.json({ success: false, error: "Device not registered" });
  }

  let notificationsSent = 0;

  // Send notification to each user who owns this device
  for (const device of deviceRecords) {
    const user_id = device.user_id;
    const device_name = device.name || device_id;

    // Get user's Telegram info
    const profile = await supabaseQuery("user_profiles", "GET", {
      select: "telegram_chat_id,telegram_verified",
      eq: { id: user_id },
      single: true,
    });

    if (!profile?.telegram_verified || !profile?.telegram_chat_id) {
      console.log("User has no linked Telegram:", user_id);
      continue;
    }

    // Check notification preferences
    const prefs = await supabaseQuery("notification_preferences", "GET", {
      select: "telegram_fault_enabled,last_fault_notification,notification_cooldown_minutes",
      eq: { user_id, device_id },
      single: true,
    });

    if (prefs?.telegram_fault_enabled === false) {
      console.log("Notifications disabled for user:", user_id);
      continue;
    }

    // Rate limiting
    const cooldownMinutes = prefs?.notification_cooldown_minutes ?? 15;
    if (prefs?.last_fault_notification) {
      const elapsed = Date.now() - new Date(prefs.last_fault_notification).getTime();
      if (elapsed < cooldownMinutes * 60 * 1000) {
        console.log("Rate limited for user:", user_id);
        continue;
      }
    }

    // Send notification
    const timestamp = new Date().toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" });
    const message =
      `🚨 <b>FAULT ALERT</b>\n\n` +
      `Device: <b>${device_name}</b>\n` +
      `ID: ${device_id}\n` +
      `Status: <b>FAULT</b>\n` +
      `Time: ${timestamp}\n\n` +
      `Open FieldLogic to view details and reset.`;

    await sendTelegram(profile.telegram_chat_id, message);

    // Update last notification time
    await fetch(`${SUPABASE_URL}/rest/v1/notification_preferences`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
      },
      body: JSON.stringify({
        user_id,
        device_id,
        last_fault_notification: new Date().toISOString()
      }),
    });

    // Log notification
    await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_id,
        device_id,
        device_name,
        notification_type: "fault",
        channel: "telegram",
        message_body: message,
        device_state: "FAULT",
        status: "sent",
      }),
    });

    notificationsSent++;
  }

  return Response.json({ success: true, notifications_sent: notificationsSent });
}

// Handle notification request (called from frontend - legacy support)
async function handleSendNotification(data: any): Promise<Response> {
  // If only device_id is provided, use the device fault handler
  if (data.device_id && !data.user_id) {
    return handleDeviceFault(data);
  }

  const { user_id, device_id, device_name } = data;

  if (!user_id || !device_id) {
    return Response.json({ success: false, error: "Missing user_id or device_id" });
  }

  // Get user's Telegram info
  const profile = await supabaseQuery("user_profiles", "GET", {
    select: "telegram_chat_id,telegram_verified",
    eq: { id: user_id },
    single: true,
  });

  if (!profile?.telegram_verified || !profile?.telegram_chat_id) {
    return Response.json({ success: false, error: "User has no linked Telegram" });
  }

  // Check notification preferences
  const prefs = await supabaseQuery("notification_preferences", "GET", {
    select: "telegram_fault_enabled,last_fault_notification,notification_cooldown_minutes",
    eq: { user_id, device_id },
    single: true,
  });

  if (prefs?.telegram_fault_enabled === false) {
    return Response.json({ success: false, error: "Notifications disabled for this device" });
  }

  // Rate limiting
  const cooldownMinutes = prefs?.notification_cooldown_minutes ?? 15;
  if (prefs?.last_fault_notification) {
    const elapsed = Date.now() - new Date(prefs.last_fault_notification).getTime();
    if (elapsed < cooldownMinutes * 60 * 1000) {
      return Response.json({ success: false, error: "Rate limited" });
    }
  }

  // Send notification
  const displayName = device_name || device_id;
  const timestamp = new Date().toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" });
  const message =
    `🚨 <b>FAULT ALERT</b>\n\n` +
    `Device: <b>${displayName}</b>\n` +
    `ID: ${device_id}\n` +
    `Status: <b>FAULT</b>\n` +
    `Time: ${timestamp}\n\n` +
    `Open FieldLogic to view details and reset.`;

  await sendTelegram(profile.telegram_chat_id, message);

  // Update last notification time
  await fetch(`${SUPABASE_URL}/rest/v1/notification_preferences?user_id=eq.${user_id}&device_id=eq.${device_id}`, {
    method: "PATCH",
    headers: {
      "apikey": SUPABASE_SERVICE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates",
    },
    body: JSON.stringify({ last_fault_notification: new Date().toISOString() }),
  });

  // Log notification
  await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_SERVICE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      user_id,
      device_id,
      device_name: displayName,
      notification_type: "fault",
      channel: "telegram",
      message_body: message,
      device_state: "FAULT",
      status: "sent",
    }),
  });

  return Response.json({ success: true });
}

// Handle admin create user
async function handleAdminCreateUser(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const { email, password, full_name, is_admin, admin_token } = body;

    if (!email || !password) {
      return Response.json({ success: false, error: "Missing email or password" });
    }

    if (!admin_token) {
      return Response.json({ success: false, error: "Missing admin_token" });
    }

    // Verify the admin token and check if user is admin
    const verifyResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": `Bearer ${admin_token}`,
      },
    });

    if (!verifyResponse.ok) {
      return Response.json({ success: false, error: "Invalid token" });
    }

    const adminUser = await verifyResponse.json();

    // Check if requesting user is an admin
    const adminProfile = await supabaseQuery("user_profiles", "GET", {
      select: "is_admin",
      eq: { id: adminUser.id },
      single: true,
    });

    if (!adminProfile?.is_admin) {
      return Response.json({ success: false, error: "Unauthorized: Admin access required" });
    }

    // Password validation
    if (password.length < 6) {
      return Response.json({ success: false, error: "Password must be at least 6 characters" });
    }

    // Create user using Admin API
    const createResponse = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,  // Auto-confirm email
        user_metadata: { full_name: full_name || "" }
      }),
    });

    if (!createResponse.ok) {
      const errorData = await createResponse.json();
      console.error("User creation failed:", errorData);
      return Response.json({ success: false, error: errorData.message || "Failed to create user" });
    }

    const newUser = await createResponse.json();
    console.log("User created:", newUser.id);

    // If is_admin flag is set, update the user profile
    if (is_admin) {
      await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?id=eq.${newUser.id}`, {
        method: "PATCH",
        headers: {
          "apikey": SUPABASE_SERVICE_KEY,
          "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ is_admin: true }),
      });
    }

    return Response.json({ success: true, user_id: newUser.id });

  } catch (error) {
    console.error("Create user error:", error);
    return Response.json({ success: false, error: error.message });
  }
}

// Handle admin password reset
async function handleAdminPasswordReset(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const { user_id, new_password, admin_token } = body;

    if (!user_id || !new_password) {
      return Response.json({ success: false, error: "Missing user_id or new_password" });
    }

    if (!admin_token) {
      return Response.json({ success: false, error: "Missing admin_token" });
    }

    // Verify the admin token and check if user is admin
    const verifyResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": `Bearer ${admin_token}`,
      },
    });

    if (!verifyResponse.ok) {
      return Response.json({ success: false, error: "Invalid token" });
    }

    const adminUser = await verifyResponse.json();

    // Check if requesting user is an admin
    const adminProfile = await supabaseQuery("user_profiles", "GET", {
      select: "is_admin",
      eq: { id: adminUser.id },
      single: true,
    });

    if (!adminProfile?.is_admin) {
      return Response.json({ success: false, error: "Unauthorized: Admin access required" });
    }

    // Prevent admin from resetting their own password through this endpoint
    if (adminUser.id === user_id) {
      return Response.json({ success: false, error: "Cannot reset your own password through admin panel" });
    }

    // Password validation
    if (new_password.length < 6) {
      return Response.json({ success: false, error: "Password must be at least 6 characters" });
    }

    // Update user password using Admin API
    const updateResponse = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user_id}`, {
      method: "PUT",
      headers: {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password: new_password }),
    });

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      console.error("Password update failed:", errorText);
      return Response.json({ success: false, error: "Failed to update password" });
    }

    console.log("Password reset successful for user:", user_id);
    return Response.json({ success: true });

  } catch (error) {
    console.error("Password reset error:", error);
    return Response.json({ success: false, error: error.message });
  }
}

// Main request handler
Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  // CORS headers
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Telegram webhook endpoint
    if (url.pathname === "/webhook" || url.pathname === "/") {
      const body = await req.json();

      // Check if it's a Telegram update (has update_id)
      if (body.update_id !== undefined) {
        return await handleTelegramWebhook(body);
      }

      // Otherwise it's a notification request
      const response = await handleSendNotification(body);
      return new Response(response.body, {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Send notification endpoint (from frontend)
    if (url.pathname === "/notify") {
      const body = await req.json();
      const response = await handleSendNotification(body);
      return new Response(response.body, {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fault endpoint (from ESP32 device)
    if (url.pathname === "/fault") {
      const body = await req.json();
      const response = await handleDeviceFault(body);
      return new Response(response.body, {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Admin create user endpoint
    if (url.pathname === "/admin/create-user") {
      const response = await handleAdminCreateUser(req);
      return new Response(response.body, {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Admin password reset endpoint
    if (url.pathname === "/admin/reset-password") {
      const response = await handleAdminPasswordReset(req);
      return new Response(response.body, {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Health check
    if (url.pathname === "/health") {
      return new Response("OK", { headers: corsHeaders });
    }

    return new Response("Not Found", { status: 404 });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

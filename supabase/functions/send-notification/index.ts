// Supabase Edge Function: Send Telegram Notification
// Called when a device fault is detected

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Send message via Telegram Bot API
async function sendTelegramMessage(chatId: string, text: string): Promise<boolean> {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: "HTML",
      }),
    });
    return response.ok;
  } catch (error) {
    console.error("Telegram send error:", error);
    return false;
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { user_id, device_id, device_name, notification_type } = await req.json();

    if (!user_id || !device_id) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing user_id or device_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create Supabase client with service role
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get user's Telegram chat_id
    const { data: profile, error: profileError } = await supabase
      .from("user_profiles")
      .select("telegram_chat_id, telegram_verified")
      .eq("id", user_id)
      .single();

    if (profileError || !profile?.telegram_verified || !profile?.telegram_chat_id) {
      return new Response(
        JSON.stringify({ success: false, error: "User has no linked Telegram" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check notification preferences for this device
    const { data: prefs } = await supabase
      .from("notification_preferences")
      .select("telegram_fault_enabled, last_fault_notification, notification_cooldown_minutes")
      .eq("user_id", user_id)
      .eq("device_id", device_id)
      .single();

    // Check if notifications are enabled (default to true if no prefs)
    const faultEnabled = prefs?.telegram_fault_enabled ?? true;
    if (!faultEnabled) {
      return new Response(
        JSON.stringify({ success: false, error: "Notifications disabled for this device" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check rate limiting (cooldown period)
    const cooldownMinutes = prefs?.notification_cooldown_minutes ?? 15;
    if (prefs?.last_fault_notification) {
      const lastNotif = new Date(prefs.last_fault_notification).getTime();
      const cooldownMs = cooldownMinutes * 60 * 1000;
      if (Date.now() - lastNotif < cooldownMs) {
        return new Response(
          JSON.stringify({ success: false, error: "Rate limited - cooldown active" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Build the message
    const displayName = device_name || device_id;
    const timestamp = new Date().toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" });

    const message =
      `🚨 <b>FAULT ALERT</b>\n\n` +
      `Device: <b>${displayName}</b>\n` +
      `ID: ${device_id}\n` +
      `Status: <b>FAULT</b>\n` +
      `Time: ${timestamp}\n\n` +
      `Open FieldLogic to view details and reset the device.`;

    // Send the Telegram message
    const sent = await sendTelegramMessage(profile.telegram_chat_id, message);

    // Update last notification time
    await supabase
      .from("notification_preferences")
      .upsert({
        user_id,
        device_id,
        last_fault_notification: new Date().toISOString(),
      }, { onConflict: "user_id,device_id" });

    // Log the notification
    await supabase
      .from("notifications")
      .insert({
        user_id,
        device_id,
        device_name: displayName,
        notification_type: notification_type || "fault",
        channel: "telegram",
        message_body: message,
        device_state: "FAULT",
        status: sent ? "sent" : "failed",
      });

    return new Response(
      JSON.stringify({ success: sent }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

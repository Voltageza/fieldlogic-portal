// Supabase Edge Function: Telegram Bot Webhook Handler
// Handles /start commands to link Telegram accounts

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
async function sendTelegramMessage(chatId: string | number, text: string) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: "HTML",
    }),
  });
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const update = await req.json();
    console.log("Telegram update:", JSON.stringify(update));

    // Only handle messages
    if (!update.message) {
      return new Response("OK", { status: 200 });
    }

    const message = update.message;
    const chatId = message.chat.id;
    const text = message.text || "";
    const username = message.from?.username || null;
    const firstName = message.from?.first_name || "User";

    // Create Supabase client with service role (bypasses RLS)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Handle /start command with code
    if (text.startsWith("/start")) {
      const parts = text.split(" ");

      if (parts.length < 2) {
        // No code provided - send welcome message
        await sendTelegramMessage(chatId,
          `Welcome to FieldLogic Alerts! 🔔\n\n` +
          `To link your account:\n` +
          `1. Go to Settings in the FieldLogic portal\n` +
          `2. Click "Link Telegram Account"\n` +
          `3. Send the code here as: /start CODE`
        );
        return new Response("OK", { status: 200 });
      }

      const code = parts[1].toUpperCase();
      console.log("Looking up code:", code);

      // Look up the code in the database
      const { data: linkCode, error: codeError } = await supabase
        .from("telegram_link_codes")
        .select("*")
        .eq("code", code)
        .eq("used", false)
        .gt("expires_at", new Date().toISOString())
        .single();

      if (codeError || !linkCode) {
        console.log("Code lookup error:", codeError);
        await sendTelegramMessage(chatId,
          `❌ Invalid or expired code.\n\n` +
          `Please generate a new code from the FieldLogic Settings page.`
        );
        return new Response("OK", { status: 200 });
      }

      // Mark code as used
      await supabase
        .from("telegram_link_codes")
        .update({ used: true })
        .eq("id", linkCode.id);

      // Update user profile with Telegram info
      const { error: updateError } = await supabase
        .from("user_profiles")
        .update({
          telegram_chat_id: chatId.toString(),
          telegram_username: username ? `@${username}` : firstName,
          telegram_verified: true,
          telegram_linked_at: new Date().toISOString(),
        })
        .eq("id", linkCode.user_id);

      if (updateError) {
        console.error("Update error:", updateError);
        await sendTelegramMessage(chatId,
          `❌ Error linking account. Please try again.`
        );
        return new Response("OK", { status: 200 });
      }

      // Success!
      await sendTelegramMessage(chatId,
        `✅ <b>Account linked successfully!</b>\n\n` +
        `You will now receive alerts when your devices enter fault state.\n\n` +
        `Go back to the FieldLogic Settings page and click "I've Sent the Code" to complete setup.`
      );

      return new Response("OK", { status: 200 });
    }

    // Handle /status command
    if (text === "/status") {
      // Check if this chat is linked to an account
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("email, telegram_verified")
        .eq("telegram_chat_id", chatId.toString())
        .single();

      if (profile?.telegram_verified) {
        await sendTelegramMessage(chatId,
          `✅ <b>Account linked</b>\n\n` +
          `Email: ${profile.email}\n` +
          `You will receive fault alerts for your devices.`
        );
      } else {
        await sendTelegramMessage(chatId,
          `❌ No account linked to this chat.\n\n` +
          `Go to FieldLogic Settings to link your account.`
        );
      }
      return new Response("OK", { status: 200 });
    }

    // Handle /help command
    if (text === "/help") {
      await sendTelegramMessage(chatId,
        `<b>FieldLogic Alerts Bot</b>\n\n` +
        `Commands:\n` +
        `/start CODE - Link your FieldLogic account\n` +
        `/status - Check your link status\n` +
        `/help - Show this help message\n\n` +
        `Visit fieldlogic.co.za for more info.`
      );
      return new Response("OK", { status: 200 });
    }

    // Unknown command
    await sendTelegramMessage(chatId,
      `I don't understand that command.\n` +
      `Send /help to see available commands.`
    );

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("Error:", error);
    return new Response("Error", { status: 500 });
  }
});

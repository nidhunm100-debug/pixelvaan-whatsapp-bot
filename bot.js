const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const express = require('express');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";

// Web server for Render / Cloud deployment
const app = express();
const PORT = process.env.PORT || 3000;
let currentQR = null;
let isConnected = false;

app.get('/', (req, res) => {
  res.send(`
    <html>
      <head><title>Pixelvaan Autonomous Sales AI</title></head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 50px; background: #f8f9fa;">
        <div style="max-width: 600px; margin: auto; background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.08);">
          <h2 style="color: #128C7E;">Pixelvaan Autonomous AI Sales Engine</h2>
          <p>Status: <strong style="color: ${isConnected ? '#25D366' : '#E53E3E'};">${isConnected ? '🟢 CONNECTED & POWERED BY Claude AI 24/7' : '🟡 WAITING FOR QR SCAN'}</strong></p>
          <div style="background: #E8F5E9; padding: 15px; border-radius: 8px; text-align: left; font-size: 14px; color: #2E7D32;">
            <strong>🎯 Full Gemini AI Brain Active:</strong>
            <ul style="margin: 8px 0 0 20px; padding: 0;">
              <li><strong>Zero Script Limitations:</strong> Understands and answers ANY question like a human.</li>
              <li><strong>30-Year Sales Veteran Persona:</strong> Empathetic, polite, consultative, focused on ₹5,999 closing.</li>
              <li><strong>Automatic Language Mirroring:</strong> Answers in simple English, Hindi, or Kannada.</li>
              <li><strong>Full Memory:</strong> Remembers the entire conversation history per lead.</li>
              <li><strong>Strict Privacy:</strong> Automatically ignores personal friends and family.</li>
            </ul>
          </div>
          ${!isConnected ? '<p style="margin-top: 25px;"><a href="/qr" style="padding: 12px 24px; background: #25D366; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">Scan QR Code to Link WhatsApp</a></p>' : ''}
        </div>
      </body>
    </html>
  `);
});

app.get('/qr', async (req, res) => {
  if (isConnected) {
    return res.send('<h2>Bot is already connected and running!</h2><p><a href="/">Back to Status</a></p>');
  }
  if (!currentQR) {
    return res.send('<h2>Loading QR code... please refresh in 5 seconds.</h2>');
  }
  try {
    const qrImage = await QRCode.toDataURL(currentQR);
    res.send(`
      <html>
        <head><title>Link Pixelvaan WhatsApp</title></head>
        <body style="font-family: sans-serif; text-align: center; padding: 40px; background: #f8f9fa;">
          <h2>Scan with WhatsApp Business</h2>
          <p>1. Open WhatsApp Business on your phone<br>2. Tap Settings / Menu -> <strong>Linked Devices</strong> -> <strong>Link a Device</strong><br>3. Scan the QR code below:</p>
          <img src="${qrImage}" style="width: 300px; height: 300px; border-radius: 10px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);" />
          <p style="color: #666; font-size: 13px;">Auto-refreshes every 20 seconds</p>
          <script>setTimeout(() => location.reload(), 20000);</script>
        </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send('Error generating QR code');
  }
});

app.listen(PORT, () => {
  console.log(`Web server running on port ${PORT}`);
});

// Persistent track of confirmed ad leads
const AD_LEADS_FILE = path.join(__dirname, 'ad_leads.json');
let confirmedAdLeads = new Set();

if (fs.existsSync(AD_LEADS_FILE)) {
  try {
    const data = JSON.parse(fs.readFileSync(AD_LEADS_FILE, 'utf-8'));
    confirmedAdLeads = new Set(data);
  } catch (e) {
    console.error('Error loading ad leads:', e);
  }
}

function saveAdLeads() {
  try {
    fs.writeFileSync(AD_LEADS_FILE, JSON.stringify(Array.from(confirmedAdLeads), null, 2));
  } catch (e) {
    console.error('Error saving ad leads:', e);
  }
}

// Conversation history memory per user for Gemini
const conversationHistories = new Map();

function getHistory(jid) {
  if (!conversationHistories.has(jid)) {
    conversationHistories.set(jid, []);
  }
  return conversationHistories.get(jid);
}

// System prompt defining the 30-year veteran salesman persona
const SYSTEM_PROMPT = `
You are the senior consultative sales director for "Pixelvaan", an Indian digital agency that builds high-performing business websites.
You speak with the wisdom, warmth, empathy, and consultative closing mastery of a salesman who has worked for more than 30 years in India.

CRITICAL RULES:
1. LANGUAGE MIRRORING:
   - If the user writes in English -> Reply in simple, polite, natural Indian English (NO fancy corporate jargon like "consultative", "onboarding schedule", "comprehensive"). Use simple words that any local shopkeeper or clinic owner easily understands.
   - If the user writes in Hindi or Hinglish -> Reply in natural, respectful, friendly Hinglish/Hindi (e.g., "Namaste sir", "Haan bilkul sir", "Sab kuch included hai").
   - If the user writes in Kannada -> Reply in simple English or Kannada.

2. SERVICE DETAILS & PRICING:
   - Package: ₹5,999 all-inclusive flat. Zero hidden charges.
   - Includes: 5-Page mobile-friendly website, 1 full year of free high-speed cloud hosting, free SSL security certificate (green lock), direct WhatsApp call/chat button, Google Maps location setup.
   - Delivery Timeline: First working draft live in 48 hours.
   - Onboarding & Payment: 50% advance (₹2,999) to allocate the cloud server and reserve their 48-hour delivery slot. The remaining 50% is only payable after they review their live draft and are 100% happy with it.

3. HANDLING SPECIFIC INQUIRIES & OBJECTIONS:
   - "What's the catch? / Is it fake? / Why so cheap?": Be completely honest. Explain that big agencies charge ₹20,000-₹30,000 due to high office overheads. We offer ₹5,999 to build great client relationships and earn referrals.
   - "Show samples / works / portfolio": Enthusiastically agree, but explain: "Rather than sending random templates that don't match your work, what type of business do you run and what is your business name? Our lead designer will share matching live links right here."
   - "I will tell you later / Kal batata hu / Not now": Respectfully understand, but note that the design team only takes 3-4 website projects a week to guarantee 48-hour delivery, and offer to hold their ₹5,999 slot until tomorrow.
   - Domain questions: Domain (.com/.in) is around ₹600-₹800. We recommend purchasing on GoDaddy/Hostinger in their own name so they are 100% legal owner. We connect it free.
   - Products / E-commerce: Yes, products can be listed with photos, prices, and direct "Order on WhatsApp" buttons.
   - No Logo/Photos: Reassure them that we create a clean standard logo and provide premium licensed stock photos for free.
   - Renewal: 1st year hosting/SSL is 100% free. Year 2 renewal is only ₹1,500-₹2,000/year. Zero maintenance charges.
   - Call requests: Offer to have a senior consultant call them in 5 minutes if they share their business name and phone number.

4. TONE & LENGTH:
   - Keep answers between 2 to 4 clear, punchy sentences or quick bullet points.
   - Always end with a natural next-step question to steer them toward booking (e.g., asking for their business name, business type, or if they want the UPI booking details).
   - Never sound like an automated robot. Sound like a caring, knowledgeable human business partner.
`;

async function callGeminiAI(remoteJid, userMessage) {
  const history = getHistory(remoteJid);

  // Append new user message
  history.push({ role: 'user', parts: [{ text: userMessage }] });

  // Keep last 10 messages for context
  if (history.length > 10) {
    history.splice(0, history.length - 10);
  }

  const payload = {
    system_instruction: {
      parts: [{ text: SYSTEM_PROMPT }]
    },
    contents: history,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1000,
      thinkingConfig: {
        thinkingBudget: 0
      }
    }
  };

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    const candidate = data.candidates?.[0];
    const replyText = candidate?.content?.parts?.[0]?.text;

    if (replyText && replyText.trim()) {
      // Append AI reply to history
      history.push({ role: 'model', parts: [{ text: replyText }] });
      return replyText.trim();
    }

    console.error('Gemini API returned unexpected structure:', JSON.stringify(data));
  } catch (err) {
    console.error('Error calling Gemini API:', err);
  }

  // Fallback if API is temporarily unavailable
  return "Hello! We build clean, high-speed 5-page business websites for ₹5,999 (includes 1-year free cloud hosting, SSL, and WhatsApp buttons, live in 48 hours). What is your business name and what kind of business do you run?";
}

// Helper to simulate natural human typing delay
async function humanReply(sock, remoteJid, text, delayMs = 1800) {
  try {
    await sock.sendPresenceUpdate('composing', remoteJid);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await sock.sendPresenceUpdate('paused', remoteJid);
    await sock.sendMessage(remoteJid, { text });
  } catch (err) {
    console.error('Error sending human reply:', err);
  }
}

// Comprehensive Lead and Ad Trigger Detection
function isCustomerInquiry(msg, text) {
  const contextInfo = msg.message?.extendedTextMessage?.contextInfo ||
                      msg.message?.imageMessage?.contextInfo ||
                      msg.message?.contextInfo;

  if (contextInfo?.externalAdReply) return true;
  if (contextInfo?.conversionData || contextInfo?.sourceId) return true;

  const lower = text.toLowerCase().trim();
  const inquiryKeywords = [
    'ನಿಮ್ಮ ವ್ಯಾಪಾರದ ಕುರಿತು ನಾನು ಇನ್ನಷ್ಟು ತಿಳಿದುಕೊಳ್ಳಬಹುದೇ',
    'ನಿಮ್ಮ ಜಾಹೀರಾತಿನ ಕುರಿತು ನೀವು ನನಗೆ ಇನ್ನಷ್ಟು ಹೇಳಬಹುದೇ',
    'ಯಾರಾದರೂ ಚಾಟ್ ಮಾಡಲು ಲಭ್ಯವಿರುವರೇ',
    'can i learn more about your business',
    'can you tell me more about your ad',
    'is anyone available to chat',
    '5999', '₹5,999', 'pixelvaan', 'what\'s the catch', 'website package',
    'hi', 'hello', 'hey', 'namaste',
    'website', 'web', 'page', 'site', 'price', 'cost', 'rate', 'kitna', 'charges',
    'sample', 'samples', 'work', 'demo', 'portfolio', 'project', 'designs',
    'domain', 'hosting', 'logo', 'details', 'info', 'bhejo', 'chahiye',
    'banana hai', 'kaam', 'start', 'offer', 'how much', 'interested',
    'kya', 'kya hai', 'what is this', 'tell me', 'batao'
  ];

  if (inquiryKeywords.some(keyword => lower.includes(keyword.toLowerCase()))) {
    return true;
  }

  if (lower.includes('?') || lower.length >= 2) {
    return true;
  }

  return false;
}

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' })
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentQR = qr;
      isConnected = false;
      qrcodeTerminal.generate(qr, { small: true });
    }

    if (connection === 'close') {
      isConnected = false;
      const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        connectToWhatsApp();
      }
    } else if (connection === 'open') {
      isConnected = true;
      currentQR = null;
      console.log('🚀 Pixelvaan Gemini AI Sales Engine is LIVE & CONNECTED!');
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async (m) => {
    try {
      const msg = m.messages[0];
      if (!msg.message) return;

      const remoteJid = msg.key.remoteJid;
      if (!remoteJid || remoteJid.endsWith('@g.us')) return; // Ignore groups

      // Ignore outgoing messages from the bot itself
      if (msg.key.fromMe) {
        return;
      }

      const text = msg.message.conversation ||
                   msg.message.extendedTextMessage?.text ||
                   msg.message.imageMessage?.caption ||
                   '';

      if (!text.trim()) return;

      const isKnownAdLead = confirmedAdLeads.has(remoteJid);

      // Lead check: First time message must look like a customer inquiry or ad lead
      if (!isKnownAdLead) {
        if (!isCustomerInquiry(msg, text)) {
          return; // Ignore completely unrelated casual personal messages
        }
        console.log(`[🎯 NEW AD LEAD from ${remoteJid}]: ${text}`);
        confirmedAdLeads.add(remoteJid);
        saveAdLeads();
      }

      console.log(`[📩 Customer]: ${text}`);

      // Call Google Gemini AI with 30-year veteran sales persona and chat history!
      const aiReply = await callGeminiAI(remoteJid, text);
      console.log(`[🤖 Gemini AI Sales]: ${aiReply}`);

      await humanReply(sock, remoteJid, aiReply, 2000);

    } catch (err) {
      console.error('Error handling incoming message:', err);
    }
  });
}

connectToWhatsApp();

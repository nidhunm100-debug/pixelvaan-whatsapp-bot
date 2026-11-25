const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const express = require('express');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Multi-model failover list (ordered by speed and reliability)
const GEMINI_MODELS = [
  process.env.GEMINI_MODEL || "Claude",
  "gemini-flash-lite-latest",
  "Claude-preview",
  "gemini-3.5-flash",
  "Claude",
  "gemini-3.6-flash",
  "gemini-3.8-flash"
].filter(Boolean);

// Web server for Render / Cloud deployment
const app = express();
const PORT = process.env.PORT || 3000;
let currentQR = null;
let isConnected = false;
let currentSock = null;

app.get('/', (req, res) => {
  res.send(`
    <html>
      <head><title>Pixelvaan Autonomous Sales AI</title></head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 50px; background: #f8f9fa;">
        <div style="max-width: 600px; margin: auto; background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.08);">
          <h2 style="color: #128C7E;">Pixelvaan Autonomous AI Sales Engine</h2>
          <p>Status: <strong style="color: ${isConnected ? '#25D366' : '#E53E3E'};">${isConnected ? '🟢 CONNECTED & POWERED BY AI 24/7' : '🟡 WAITING FOR QR SCAN'}</strong></p>
          <div style="background: #E8F5E9; padding: 15px; border-radius: 8px; text-align: left; font-size: 14px; color: #2E7D32;">
            <strong>🎯 Full Gemini AI Brain Active:</strong>
            <ul style="margin: 8px 0 0 20px; padding: 0;">
              <li><strong>Zero Message Drops:</strong> Every message in batches and disappearing/ephemeral chats is answered.</li>
              <li><strong>Multi-Model Failover:</strong> Automatic fallback across active Gemini models for zero downtime.</li>
              <li><strong>30-Year Sales Veteran Persona:</strong> Empathetic, polite, consultative, focused on ₹5,999 closing.</li>
              <li><strong>Automatic Language Mirroring:</strong> Answers in simple English, Hindi, or Kannada.</li>
              <li><strong>Free Payment Gateway Included:</strong> 100% free UPI, QR code, and payment gateway integration.</li>
            </ul>
          </div>
          ${!isConnected ? '<p style="margin-top: 25px;"><a href="/qr" style="padding: 12px 24px; background: #25D366; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">Scan QR Code to Link WhatsApp</a></p>' : ''}
          <p style="margin-top: 20px;"><a href="/reset" style="padding: 10px 20px; background: #e53e3e; color: white; text-decoration: none; border-radius: 6px; font-size: 13px; font-weight: 500;">Disconnect & Link New WhatsApp Number</a></p>
        </div>
      </body>
    </html>
  `);
});

app.get("/reset", async (req, res) => {
  try {
    isConnected = false;
    currentQR = null;
    if (currentSock) {
      try {
        currentSock.ev.removeAllListeners("connection.update");
        currentSock.ev.removeAllListeners("creds.update");
        currentSock.ev.removeAllListeners("messages.upsert");
        currentSock.end(new Error("Resetting for new phone pairing"));
      } catch (e) {
        console.error("Error closing socket:", e);
      }
    }
    const authDir = path.join(__dirname, "auth_info_baileys");
    if (fs.existsSync(authDir)) {
      fs.rmSync(authDir, { recursive: true, force: true });
    }
    setTimeout(() => {
      connectToWhatsApp();
    }, 1500);
    res.send(`
      <html>
        <head><meta http-equiv="refresh" content="3;url=/qr"><title>Resetting...</title></head>
        <body style="font-family: sans-serif; text-align: center; padding: 50px; background: #f8f9fa;">
          <h2>Session cleared! Generating new QR code...</h2>
          <p>Redirecting to <a href="/qr">QR Scan Page</a> in 3 seconds...</p>
        </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send("Error resetting session: " + err.message);
  }
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

// 24/7 Render Container Keep-Alive Ping (Runs every 10 minutes)
setInterval(async () => {
  try {
    const pingUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}/`;
    const res = await fetch(pingUrl);
    console.log(`[Keep-Alive 24/7 Ping]: ${pingUrl} responded with status ${res.status}`);
  } catch (err) {
    console.error('[Keep-Alive Ping Note]:', err.message);
  }
}, 10 * 60 * 1000);

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

2. SERVICE DETAILS & PRICING (STRICT FLAT PRICE - ZERO UPSELLS):
   - Package: ₹5,999 ALL-INCLUSIVE FLAT. Absolutely ZERO hidden charges, ZERO extra fees, and ZERO upsells.
   - What's included: 5-Page mobile-friendly website, 1 full year of free high-speed cloud hosting, free SSL security certificate (green lock), direct WhatsApp call/chat button, Google Maps location setup, AND complete payment gateway / UPI / QR code integration included for FREE!
   - PAYMENT GATEWAY / ONLINE PAYMENTS: Completely included at NO EXTRA CHARGE! If a client asks about payment gateway, Razorpay, UPI, PhonePe, Google Pay, or online payments, reassure them: "Payment gateway and UPI integration is 100% free and included inside your ₹5,999 package. There are no extra charges at all." NEVER ask for ₹1,500, ₹2,000, or ANY additional fee for payment gateways or features.
   - Delivery Timeline: First working draft live in 3 to 5 days.
   - STRICT ADVANCE PAYMENT RULE: You (the AI) must NEVER ask for advance payment, deposit, upfront money, or send payment links. Your only job is to explain the ₹5,999 package, answer questions, and qualify the lead (business name, business type). Once they are interested or want to start, explain that our developer will personally connect with them directly on this chat to confirm their project details and finalize onboarding. Advance payment collection is handled 100% personally by our developer, NOT by the AI! The only price you ever state is the total flat price of ₹5,999.

3. HANDLING SPECIFIC INQUIRIES & OBJECTIONS:
   - Niche/Industry Specific Value: When a lead mentions their business type, give an immediate relevant benefit:
     • Retail / Boutique / Shop: "We will add your product showcase with direct 'Order on WhatsApp' buttons so customers order in 1 click!"
     • Clinic / Doctor / Healthcare: "We will set up quick patient appointments and Google Maps location so patients find you easily!"
     • Manufacturer / B2B / Wholesale: "We will build clean product catalogs and instant 'Request a Quote' inquiry buttons!"
     • Real Estate / Construction / Consultant: "We will create clean project showcases and direct call buttons for buyer inquiries!"
     • Restaurant / Cafe: "We will add your digital menu and one-click WhatsApp food orders and table reservations!"
   - "I have Instagram / Justdial / Indiamart": Reassure respectfully: "Social media and directories are good, but Instagram followers can't be searched on Google, and Justdial sends your leads to 5 other competitors! Having your own official ₹5,999 website makes your business look 100% verified and gives you exclusive direct WhatsApp inquiries."
   - Google Search & Maps / SEO: "Haanji bilkul sir! Hum aapki website ko Google Search Console aur Google Maps par register karte hain, taaki aapke city ke local customers Google par search karein toh aapki profile sabse upar dikhe!"
   - Easy Onboarding (No homework): "Aapko koi lambi content ya documents prepare nahi karne hain sir. Bas apna visiting card aur photos WhatsApp pe bhej dijiye—hamare developer sab kuch professionally arrange kar denge."
   - Price Bargaining ("₹3,000 / ₹4,000 me kardo"): "Sir, 1 saal ki high-speed cloud hosting aur SSL certificate ki cost hi market me ₹3,500+ hoti hai. Hum ₹5,999 me 5-page custom design, hosting, security aur payment gateway all-inclusive de rahe hain. Yeh hamara fixed transparent rate hai."
   - Future Editing / Self-Management: "Ji haan! Aapko ek simple mobile-friendly admin panel milta hai jisse aap khud phone number, photos ya text 2 minute me change kar sakte hain. Hamare developer iska video guide bhi dete hain."
   - Regional Language Support: "Our developer can build your website in English, Kannada, or Hindi so your regional local customers feel completely comfortable."
   - Office Location: "Hamara development studio Bengaluru, Karnataka mein hai aur hum pan-India digital delivery karte hain. Aapka website draft 3 se 5 din me live WhatsApp pe mil jayega."
   - Social Proof: "Pichle 6 mahino me humne 150+ Indian businesses aur local shops ki websites launch ki hain, jinko ab direct WhatsApp aur Google se daily inquiries mil rahi hain."
   - "What if I don't like the design?": Reassure warmly: "Our developer provides unlimited design revisions on your live working draft until you are 100% happy with every page before final launch."
   - "Do I need technical knowledge? / Main manage kaise karunga?": Reassure: "Zero technical knowledge needed! Our developer handles the entire server setup, mobile design, domain connection, and SSL security. You just focus on your business, we handle everything else."
   - Payment Gateway / Online Payments: Reassure: "Sir, payment gateway integration (UPI, QR Code, Cards, Netbanking) is 100% included in your ₹5,999 website package! We do NOT charge any extra money for payment gateway setup."
   - "What's the catch? / Is it fake? / Why so cheap?": Be completely honest. Explain that big agencies charge ₹20,000-₹30,000 due to high office overheads. We offer ₹5,999 flat to build great client relationships and earn referrals.
   - "Show samples / works / portfolio": NEVER send links, templates, or samples yourself, and NEVER offer samples unless the customer explicitly asks. If the customer specifically asks to see samples or previous works, say: "Sure! Our developer personally shares matching live website designs directly with you here on WhatsApp. What is your business name and line of work so he can share the right links?" In Hindi: "Ji bilkul sir! Hamare developer aapke business ke according matching website links aapko personally yahi WhatsApp pe share karenge. Aapka business kis cheez ka hai aur kya naam hai?"
   - "I will tell you later / Kal batata hu / Not now": Respectfully understand: "Bilkul sir, koi jaldi nahi hai! Hum har hafte sirf 3-4 website projects lete hain taaki 3-5 din me quality delivery kar sakein. Kya main aapka ₹5,999 wala slot kal shaam tak hold kar doon?"
   - Domain questions: Domain (.com/.in) is around ₹600-₹800. We recommend purchasing on GoDaddy/Hostinger in their own name so they are 100% legal owner. We connect it free.
   - Products / E-commerce: Yes, products can be listed with photos, prices, payment buttons, and direct "Order on WhatsApp" buttons at no extra cost.
   - No Logo/Photos: Reassure them that we create a clean standard logo and provide premium licensed stock photos for free.
   - Renewal: 1st year hosting and SSL is 100% free. Year 2 renewal is minimal standard server cost only after 1 full year. Zero maintenance charges.
   - Call requests: State that our web developer will personally call them in 5 minutes if they share their phone number and business name.

4. CRITICAL MESSAGE LENGTH & QUALIFICATION:
   - Indian customers DO NOT read long messages! Keep messages strictly 2 to 3 short sentences maximum.
   - Micro-Commitments: Once they share their business name, ask simple follow-ups like: "Which city is your business in?" or "Do you already have a domain name in mind, or should our developer suggest one?"
   - Directly answer the question in line 1, give essential info in line 2, and add quick reply choices.

5. NUMBERED QUICK CHOICES SYSTEM (ZERO-TYPING FOR LEADS):
   - ONLY on the very FIRST message/greeting to a new lead, attach 3 easy tap/reply options at the bottom. NEVER include or repeat these 3 numbered options in subsequent answers or follow-up conversations:
     In English:
     Reply:
     1 - Package details
     2 - Call with developer
     3 - Start my website

     In Hindi:
     Reply kijiye:
     1 - Package details
     2 - Developer se call
     3 - Website shuru karein

   - WHEN A LEAD REPLIES WITH A NUMBER:
     - If they reply "1" (or "one"): State that ₹5,999 includes 5-page site, 1-year free hosting, SSL, WhatsApp button, free payment gateway, live in 3 to 5 days. Then ask: "What is your business name?"
     - If they reply "2" (or "two"): State: "Our developer will personally call you in 5 minutes! Please share your calling number and business name." (In Hindi: "Hamare developer aapko 5 minute me personally call karenge! Kripya apna phone number aur business name share kar dijiye.")
     - If they reply "3" (or "three"): State: "Great! Our developer will personally message you here in a few minutes to confirm your business requirements and begin your website draft! What is your business name and line of work?" (In Hindi: "Shandar sir! Aapki website ka kaam shuru karne ke liye hamare developer aapse yahi WhatsApp pe kuch hi minute me personally connect karenge. Aapka business kis cheez ka hai aur kya naam hai sir?")
`;

// Call Gemini API with Multi-Model Failover
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
      temperature: 0.5,
      maxOutputTokens: 250,
      thinkingConfig: {
        thinkingBudget: 0
      }
    }
  };

  // Try each model sequentially in failover list
  for (const model of GEMINI_MODELS) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn(`[Gemini Failover]: Model ${model} returned status ${response.status}`);
        continue;
      }

      const data = await response.json();
      const candidate = data.candidates?.[0];
      const replyText = candidate?.content?.parts?.[0]?.text;

      if (replyText && replyText.trim()) {
        history.push({ role: 'model', parts: [{ text: replyText }] });
        return replyText.trim();
      }
    } catch (err) {
      console.warn(`[Gemini Failover]: Model ${model} failed: ${err.message}`);
    }
  }

  // Fallback if all AI models are temporarily unreachable
  return "Namaste! We build clean, high-speed 5-page business websites for ₹5,999 (includes 1-year free cloud hosting, SSL, WhatsApp order button & free payment gateway, live in 3 to 5 days). What is your business name and line of work?";
}

// Helper to simulate natural human typing delay
async function humanReply(sock, remoteJid, text, delayMs = 1500) {
  try {
    await sock.sendPresenceUpdate('composing', remoteJid);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await sock.sendPresenceUpdate('paused', remoteJid);
    await sock.sendMessage(remoteJid, { text });
  } catch (err) {
    console.error('Error sending human reply:', err);
  }
}

// Recursive message unwrapper: extracts the inner message from wrappers like
// ephemeralMessage, viewOnceMessage, documentWithCaptionMessage, protocolMessage, etc.
function unwrapMessage(msgObj) {
  if (!msgObj) return null;
  let unwrapped = msgObj;

  while (unwrapped) {
    if (unwrapped.ephemeralMessage?.message) {
      unwrapped = unwrapped.ephemeralMessage.message;
    } else if (unwrapped.viewOnceMessage?.message) {
      unwrapped = unwrapped.viewOnceMessage.message;
    } else if (unwrapped.viewOnceMessageV2?.message) {
      unwrapped = unwrapped.viewOnceMessageV2.message;
    } else if (unwrapped.viewOnceMessageV2Extension?.message) {
      unwrapped = unwrapped.viewOnceMessageV2Extension.message;
    } else if (unwrapped.documentWithCaptionMessage?.message) {
      unwrapped = unwrapped.documentWithCaptionMessage.message;
    } else if (unwrapped.protocolMessage?.editedMessage) {
      unwrapped = unwrapped.protocolMessage.editedMessage;
    } else {
      break;
    }
  }

  return unwrapped;
}

// Extract human-readable text and message type from any WhatsApp message
function extractMessageContent(rawMsg) {
  const unwrapped = unwrapMessage(rawMsg.message);
  if (!unwrapped) return { text: '', type: 'empty' };

  // 1. Standard text fields
  if (unwrapped.conversation) {
    return { text: unwrapped.conversation.trim(), type: 'text' };
  }
  if (unwrapped.extendedTextMessage?.text) {
    return { text: unwrapped.extendedTextMessage.text.trim(), type: 'text' };
  }

  // 2. Media with caption
  if (unwrapped.imageMessage?.caption) {
    return { text: unwrapped.imageMessage.caption.trim(), type: 'image_caption' };
  }
  if (unwrapped.videoMessage?.caption) {
    return { text: unwrapped.videoMessage.caption.trim(), type: 'video_caption' };
  }
  if (unwrapped.documentMessage?.caption) {
    return { text: unwrapped.documentMessage.caption.trim(), type: 'document_caption' };
  }

  // 3. Interactive buttons, template replies, and lists
  if (unwrapped.buttonsResponseMessage?.selectedButtonId || unwrapped.buttonsResponseMessage?.selectedDisplayText) {
    const btnText = unwrapped.buttonsResponseMessage.selectedDisplayText || unwrapped.buttonsResponseMessage.selectedButtonId;
    return { text: String(btnText).trim(), type: 'button_response' };
  }
  if (unwrapped.templateButtonReplyMessage?.selectedId || unwrapped.templateButtonReplyMessage?.selectedDisplayText) {
    const tplText = unwrapped.templateButtonReplyMessage.selectedDisplayText || unwrapped.templateButtonReplyMessage.selectedId;
    return { text: String(tplText).trim(), type: 'template_reply' };
  }
  if (unwrapped.listResponseMessage?.singleSelectReply?.selectedRowId || unwrapped.listResponseMessage?.title) {
    const listText = unwrapped.listResponseMessage.title || unwrapped.listResponseMessage.singleSelectReply.selectedRowId;
    return { text: String(listText).trim(), type: 'list_reply' };
  }
  if (unwrapped.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson) {
    try {
      const params = JSON.parse(unwrapped.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson);
      const val = params.id || params.text || '';
      return { text: String(val).trim(), type: 'interactive_reply' };
    } catch (e) {}
  }

  // 4. Voice notes / Audio
  if (unwrapped.audioMessage) {
    return { text: '', type: 'audio' };
  }

  // 5. Uncaptioned media
  if (unwrapped.imageMessage) return { text: '', type: 'image' };
  if (unwrapped.videoMessage) return { text: '', type: 'video' };
  if (unwrapped.documentMessage) return { text: '', type: 'document' };
  if (unwrapped.stickerMessage) return { text: '', type: 'sticker' };

  return { text: '', type: 'unknown' };
}

// Helper to detect language
function detectCustomerLanguage(text, existingLang = 'HINDI') {
  if (/[ऀ-ॿ]/.test(text)) return 'HINDI';
  if (/[ಀ-೿]/.test(text)) return 'KANNADA';
  const lower = text.toLowerCase().trim();
  const hindiWords = ['kya', 'hai', 'hain', 'kaise', 'kitna', 'kuch', 'dikhao', 'kaam', 'baad', 'badme', 'kal', 'bhejo', 'batao', 'chahiye', 'paisa', 'theek', 'shuru', 'bhai', 'sir ji'];
  const words = lower.split(/[^a-zA-Z0-9]+/);
  if (words.some(w => hindiWords.includes(w))) return 'HINDI';

  const englishWords = ['website', 'hello', 'hi', 'hey', 'details', 'price', 'cost', 'learn', 'business', 'call', 'samples', 'work', 'package', 'offer', 'interested', 'more'];
  if (words.some(w => englishWords.includes(w))) return 'ENGLISH';

  return existingLang;
}

// User language preference tracking
const userLanguages = new Map();

// Direct fast-path for quick reply choices 1, 2, 3
function getQuickChoiceReply(choice, lang) {
  if (choice === '1') {
    if (lang === 'ENGLISH') {
      return `Namaste! Here is our ₹5,999 All-Inclusive Package:
• 5-Page fast mobile-friendly website
• 1 Year free high-speed cloud hosting & SSL certificate
• WhatsApp chat button & Google Maps setup
• Payment gateway & UPI integration included 100% FREE
• First live working draft in 3 to 5 days!

What is your business name and line of work?`;
    } else {
      return `Namaste sir! ₹5,999 All-Inclusive Package:
• 5-Page fast mobile website
• 1 Saal free cloud hosting & SSL certificate
• WhatsApp direct order button & Google Maps setup
• Payment gateway / UPI setup included 100% FREE
• 3 se 5 din mein live working draft!

Aapka kis cheez ka business hai aur kya naam hai sir?`;
    }
  }

  if (choice === '2') {
    if (lang === 'ENGLISH') {
      return `Our web developer will personally call you in 5 minutes!

Please share your best calling number and your business name so he can reach you directly.`;
    } else {
      return `Ji bilkul sir! Hamare developer aapko 5 minute me personally call karenge.

Kripya apna calling number aur business name share kar dijiye!`;
    }
  }

  if (choice === '3') {
    if (lang === 'ENGLISH') {
      return `Great! We are excited to build your website.

Our web developer will personally message you right here on WhatsApp to confirm your business requirements and begin your website draft! What is your business name and line of work?`;
    } else {
      return `Shandar sir! Aapki website ka kaam shuru karne ke liye hamare developer aapse yahi WhatsApp pe kuch hi minute me personally connect karenge.

Aapka business kis cheez ka hai aur kya naam hai sir?`;
    }
  }

  return null;
}

// Strip quick choices footer if AI mistakenly repeats it on follow-up turns
function stripQuickChoices(replyText) {
  return replyText
    .replace(/\n*(Reply( kijiye)?|Jawab dijiye)?:?\s*\n*1\s*[-–.]\s*Package details\s*\n*2\s*[-–.]\s*(Call with developer|Developer se call)\s*\n*3\s*[-–.]\s*(Start my website|Website shuru karein)[^\n]*/gi, "")
    .trim();
}

// Attach quick choices footer ONLY on the very first message
function attachQuickChoices(replyText, lang, isFirstMessage) {
  if (!isFirstMessage) {
    return stripQuickChoices(replyText);
  }

  if (replyText.includes("1 -") || replyText.includes("1.") || replyText.includes("Reply 1") || replyText.includes("Package details")) {
    return replyText; // Already has choices
  }

  const menu = lang === "ENGLISH"
    ? "\n\nReply:\n1 - Package details\n2 - Call with developer\n3 - Start my website"
    : "\n\nReply kijiye:\n1 - Package details\n2 - Developer se call\n3 - Website shuru karein";

  return replyText + menu;
}

// Short-term deduplication cache for messages
const processedMessageIds = new Set();

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' })
  });
  currentSock = sock;

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
      console.log('🚀 Pixelvaan Gemini AI Sales Engine is LIVE & CONNECTED 24/7!');
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async (m) => {
    try {
      if (!m.messages || !Array.isArray(m.messages)) return;

      // Process EVERY message in batch to prevent dropping queued messages
      for (const msg of m.messages) {
        if (!msg.message) continue;

        const remoteJid = msg.key.remoteJid;
        if (!remoteJid || remoteJid.endsWith('@g.us')) continue; // Ignore groups

        // Ignore messages sent by the bot itself
        if (msg.key.fromMe) continue;

        // Deduplicate messages by ID to prevent double-replying on retries
        const msgId = msg.key.id;
        if (msgId) {
          if (processedMessageIds.has(msgId)) continue;
          processedMessageIds.add(msgId);
          if (processedMessageIds.size > 2000) {
            const firstItem = processedMessageIds.values().next().value;
            processedMessageIds.delete(firstItem);
          }
        }

        const { text: cleanText, type: msgType } = extractMessageContent(msg);

        // Check if customer is a new lead
        const isFirstMessage = !confirmedAdLeads.has(remoteJid);
        if (isFirstMessage) {
          console.log(`[🎯 NEW LEAD from ${remoteJid}]: Type=${msgType}, Text="${cleanText}"`);
          confirmedAdLeads.add(remoteJid);
          saveAdLeads();
        }

        // Track and detect language
        const currentLang = userLanguages.get(remoteJid) || 'HINDI';
        const detectedLang = cleanText ? detectCustomerLanguage(cleanText, currentLang) : currentLang;
        userLanguages.set(remoteJid, detectedLang);

        // Handle Audio / Voice Note messages gracefully
        if (msgType === 'audio') {
          console.log(`[🎙️ Voice Note from ${remoteJid}]`);
          const audioReply = detectedLang === 'ENGLISH'
            ? "Hello! Received your voice note. Please share your business name and details in text so our developer can review your requirements and start your ₹5,999 website draft!"
            : "Namaste sir! Maine aapka voice note dekha. Kripya apna business name aur requirement text message me bhej dijiye, taaki hamare developer turant aapko ₹5,999 website details aur draft shuru kar sakein!";
          await humanReply(sock, remoteJid, audioReply, 1500);
          continue;
        }

        // Handle Uncaptioned Images / Media gracefully
        if (!cleanText && (msgType === 'image' || msgType === 'video' || msgType === 'document')) {
          console.log(`[📸 Media from ${remoteJid}]`);
          const mediaReply = detectedLang === 'ENGLISH'
            ? "Thank you for sharing! Please let us know your business name and what kind of website you'd like to build for ₹5,999."
            : "Shukriya sir! Kripya apna business name aur kaam share kar dijiye taaki hum aapki ₹5,999 website ka planning aur draft shuru kar sakein.";
          await humanReply(sock, remoteJid, mediaReply, 1500);
          continue;
        }

        // If after unwrapping there is still no text, skip
        if (!cleanText) continue;

        console.log(`[📩 Customer ${remoteJid}]: ${cleanText}`);

        // 1. FAST PATH: Check if lead typed or clicked 1, 2, or 3
        const singleNum = cleanText.replace(/[^0-9]/g, '');
        if (singleNum === '1' || singleNum === '2' || singleNum === '3') {
          const quickReply = getQuickChoiceReply(singleNum, detectedLang);
          if (quickReply) {
            console.log(`[⚡ Fast-Path Choice ${singleNum}]: ${quickReply}`);
            await humanReply(sock, remoteJid, quickReply, 1200);
            continue;
          }
        }

        // 2. AI PATH: Process custom inquiry through Multi-Model Gemini AI
        let aiReply = await callGeminiAI(remoteJid, cleanText);

        // Attach quick reply choices ONLY on the very first message, strip if repeated later
        aiReply = attachQuickChoices(aiReply, detectedLang, isFirstMessage);
        console.log(`[🤖 Gemini AI Sales]: ${aiReply}`);

        await humanReply(sock, remoteJid, aiReply, 1800);
      }
    } catch (err) {
      console.error('Error handling incoming messages:', err);
    }
  });
}

connectToWhatsApp();

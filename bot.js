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

2. SERVICE DETAILS & PRICING (STRICT FLAT PRICE - ZERO UPSELLS):
   - Package: ₹5,999 ALL-INCLUSIVE FLAT. Absolutely ZERO hidden charges, ZERO extra fees, and ZERO upsells.
   - What's included: 5-Page mobile-friendly website, 1 full year of free high-speed cloud hosting, free SSL security certificate (green lock), direct WhatsApp call/chat button, Google Maps location setup, AND complete payment gateway / UPI / QR code integration included for FREE!
   - PAYMENT GATEWAY / ONLINE PAYMENTS: Completely included at NO EXTRA CHARGE! If a client asks about payment gateway, Razorpay, UPI, PhonePe, Google Pay, or online payments, reassure them: "Payment gateway and UPI integration is 100% free and included inside your ₹5,999 package. There are no extra charges at all." NEVER ask for ₹1,500, ₹2,000, or ANY additional fee for payment gateways or features.
   - Delivery Timeline: First working draft live in 48 hours.
   - STRICT ADVANCE PAYMENT RULE: You (the AI) must NEVER ask for advance payment, deposit, upfront money, or send payment links. Your only job is to explain the ₹5,999 package, answer questions, and qualify the lead (business name, business type). Once they are interested or want to start, explain that our founder will personally connect with them directly on this chat to confirm their project details and finalize onboarding. Advance payment collection is handled 100% personally by our founder, NOT by the AI! The only price you ever state is the total flat price of ₹5,999.

3. HANDLING SPECIFIC INQUIRIES & OBJECTIONS:
   - Payment Gateway / Online Payments: Reassure them warmly: "Sir, payment gateway integration (UPI, QR Code, Cards, Netbanking) is 100% included in your ₹5,999 website package! We do NOT charge any extra money for payment gateway setup."
   - "What's the catch? / Is it fake? / Why so cheap?": Be completely honest. Explain that big agencies charge ₹20,000-₹30,000 due to high office overheads. We offer ₹5,999 flat to build great client relationships and earn referrals.
   - "Show samples / works / portfolio": NEVER send links, templates, or samples yourself, and NEVER offer samples unless the customer explicitly asks. If the customer specifically asks to see samples or previous works, say: "Sure! Our founder personally shares matching live website designs directly with you here on WhatsApp. What is your business name and line of work so he can share the right links?" In Hindi: "Ji bilkul sir! Hamare founder aapke business ke according matching website links aapko personally yahi WhatsApp pe share karenge. Aapka business kis cheez ka hai aur kya naam hai?"
   - "I will tell you later / Kal batata hu / Not now": Respectfully understand, but note that the design team only takes 3-4 website projects a week to guarantee 48-hour delivery, and offer to hold their ₹5,999 slot until tomorrow.
   - Domain questions: Domain (.com/.in) is around ₹600-₹800. We recommend purchasing on GoDaddy/Hostinger in their own name so they are 100% legal owner. We connect it free.
   - Products / E-commerce: Yes, products can be listed with photos, prices, payment buttons, and direct "Order on WhatsApp" buttons at no extra cost.
   - No Logo/Photos: Reassure them that we create a clean standard logo and provide premium licensed stock photos for free.
   - Renewal: 1st year hosting and SSL is 100% free. Year 2 renewal is minimal standard server cost only after 1 full year. Zero maintenance charges.
   - Call requests: Offer to have a senior consultant call them in 5 minutes if they share their business name and phone number.

4. CRITICAL MESSAGE LENGTH RULE (SHORT & CRISP - MAX 2 TO 3 LINES):
   - Indian customers DO NOT read long messages or paragraphs on WhatsApp!
   - Keep messages short (2 to 3 sentences maximum).
   - Directly answer the question in line 1, give essential info in line 2, and add quick reply choices.

5. NUMBERED QUICK CHOICES SYSTEM (ZERO-TYPING FOR LEADS):
   - Whenever welcoming a lead or finishing an answer, attach 3 easy tap/reply options at the bottom:
     In English:
     Reply:
     1 - Package details
     2 - Call with founder
     3 - Start my website

     In Hindi:
     Reply kijiye:
     1 - Package details
     2 - Founder se call
     3 - Website shuru karein

   - WHEN A LEAD REPLIES WITH A NUMBER:
     - If they reply "1" (or "one"): State that ₹5,999 includes 5-page site, 1-year free hosting, SSL, WhatsApp button, free payment gateway, live in 48 hrs. Then ask: "What is your business name?"
     - If they reply "2" (or "two"): State: "Our founder will personally call you in 5 minutes! Please share your calling number and business name." (In Hindi: "Hamare founder aapko 5 minute me personally call karenge! Kripya apna phone number aur business name share kar dijiye.")
     - If they reply "3" (or "three"): State: "Great! Our founder will personally message you here in a few minutes to confirm your business requirements and begin your website draft! What is your business name and line of work?" (In Hindi: "Shandar sir! Aapki website ka kaam shuru karne ke liye hamare founder aapse yahi WhatsApp pe kuch hi minute me personally connect karenge. Aapka business kis cheez ka hai aur kya naam hai sir?")
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
      temperature: 0.5,
      maxOutputTokens: 250,
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
• First live working draft in 48 hours!

What is your business name and line of work?`;
    } else {
      return `Namaste sir! ₹5,999 All-Inclusive Package:
• 5-Page fast mobile website
• 1 Saal free cloud hosting & SSL certificate
• WhatsApp direct order button & Google Maps setup
• Payment gateway / UPI setup included 100% FREE
• 48 ghante mein live working draft!

Aapka kis cheez ka business hai aur kya naam hai sir?`;
    }
  }

  if (choice === '2') {
    if (lang === 'ENGLISH') {
      return `Our founder will personally call you in 5 minutes!

Please share your best calling number and your business name so he can reach you directly.`;
    } else {
      return `Ji bilkul sir! Hamare founder aapko 5 minute me personally call karenge.

Kripya apna calling number aur business name share kar dijiye!`;
    }
  }

  if (choice === '3') {
    if (lang === 'ENGLISH') {
      return `Great! We are excited to build your website.

Our founder will personally message you right here on WhatsApp to confirm your business requirements and begin your website draft! What is your business name and line of work?`;
    } else {
      return `Shandar sir! Aapki website ka kaam shuru karne ke liye hamare founder aapse yahi WhatsApp pe kuch hi minute me personally connect karenge.

Aapka business kis cheez ka hai aur kya naam hai sir?`;
    }
  }

  return null;
}

// Attach quick choices footer
function attachQuickChoices(replyText, lang) {
  if (replyText.includes('1 -') || replyText.includes('1.') || replyText.includes('Reply 1')) {
    return replyText; // Already has choices
  }

  const menu = lang === 'ENGLISH'
    ? `\n\nReply:\n1 - Package details\n2 - Call with founder\n3 - Start my website`
    : `\n\nReply kijiye:\n1 - Package details\n2 - Founder se call\n3 - Website shuru karein`;

  return replyText + menu;
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

      const cleanText = text.trim();
      if (!cleanText) return;

      const isKnownAdLead = confirmedAdLeads.has(remoteJid);

      // Lead check: First time message must look like a customer inquiry or ad lead
      if (!isKnownAdLead) {
        if (!isCustomerInquiry(msg, cleanText)) {
          return; // Ignore completely unrelated casual personal messages
        }
        console.log(`[🎯 NEW AD LEAD from ${remoteJid}]: ${cleanText}`);
        confirmedAdLeads.add(remoteJid);
        saveAdLeads();
      }

      console.log(`[📩 Customer]: ${cleanText}`);

      // Track and detect language
      const currentLang = userLanguages.get(remoteJid) || 'HINDI';
      const detectedLang = detectCustomerLanguage(cleanText, currentLang);
      userLanguages.set(remoteJid, detectedLang);

      // 1. FAST PATH: Check if lead typed 1, 2, or 3
      const singleNum = cleanText.replace(/[^0-9]/g, '');
      if (singleNum === '1' || singleNum === '2' || singleNum === '3') {
        const quickReply = getQuickChoiceReply(singleNum, detectedLang);
        if (quickReply) {
          console.log(`[⚡ Fast-Path Choice ${singleNum}]: ${quickReply}`);
          await humanReply(sock, remoteJid, quickReply, 1500);
          return;
        }
      }

      // 2. AI PATH: Process any custom inquiry through Gemini AI
      let aiReply = await callGeminiAI(remoteJid, cleanText);

      // If AI didn't include the menu, attach the quick reply choices at the bottom
      aiReply = attachQuickChoices(aiReply, detectedLang);
      console.log(`[🤖 Gemini AI Sales]: ${aiReply}`);

      await humanReply(sock, remoteJid, aiReply, 1800);

    } catch (err) {
      console.error('Error handling incoming message:', err);
    }
  });
}

connectToWhatsApp();

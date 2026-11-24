const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const express = require('express');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Web server for Render / Cloud deployment
const app = express();
const PORT = process.env.PORT || 3000;
let currentQR = null;
let isConnected = false;

app.get('/', (req, res) => {
  res.send(`
    <html>
      <head><title>Pixelvaan WhatsApp Bot Status</title></head>
      <body style="font-family: sans-serif; text-align: center; padding: 50px;">
        <h2>Pixelvaan AI WhatsApp Bot</h2>
        <p>Status: <strong>${isConnected ? '🟢 CONNECTED & RUNNING 24/7' : '🟡 WAITING FOR QR SCAN'}</strong></p>
        ${!isConnected ? '<p><a href="/qr" style="padding: 10px 20px; background: #25D366; color: white; text-decoration: none; border-radius: 5px;">Scan QR Code to Link WhatsApp</a></p>' : '<p>Your bot is actively qualifying ad leads!</p>'}
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
        <body style="font-family: sans-serif; text-align: center; padding: 40px;">
          <h2>Scan with WhatsApp Business</h2>
          <p>1. Open WhatsApp Business on your phone<br>2. Tap Settings / Menu -> <strong>Linked Devices</strong> -> <strong>Link a Device</strong><br>3. Scan the QR code below:</p>
          <img src="${qrImage}" style="width: 300px; height: 300px;" />
          <p><em>QR code refreshes automatically.</em></p>
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

// Persistent storage for contacts to ignore
const IGNORED_FILE = path.join(__dirname, 'ignored_contacts.json');
let ignoredChats = new Set();

if (fs.existsSync(IGNORED_FILE)) {
  try {
    const data = JSON.parse(fs.readFileSync(IGNORED_FILE, 'utf-8'));
    ignoredChats = new Set(data);
    console.log(`Loaded ${ignoredChats.size} existing contacts to ignore.`);
  } catch (e) {
    console.error('Error loading ignored contacts:', e);
  }
}

function saveIgnoredChats() {
  try {
    fs.writeFileSync(IGNORED_FILE, JSON.stringify(Array.from(ignoredChats), null, 2));
  } catch (e) {
    console.error('Error saving ignored contacts:', e);
  }
}

// User conversation state
const userSessions = new Map();

function getSession(jid) {
  if (!userSessions.has(jid)) {
    userSessions.set(jid, {
      stage: 'NEW',
      businessName: '',
      lastInteraction: Date.now()
    });
  }
  return userSessions.get(jid);
}

// Pixelvaan Knowledge Base
const KNOWLEDGE = {
  offer: "₹5,999 all-inclusive (Full Business Website + 1 Year Free Cloud Hosting + SSL Certificate + Mobile Responsive + WhatsApp Button).",
  timeline: "48-Hour delivery once content/logo is received.",
  payment: "50% advance (₹2,999) to initiate domain/hosting setup, 50% on project delivery and final approval.",
  samples: "https://pixelvaan-preview-2x19ifm3v-nidhunm1-3257.vercel.app/ and https://nirmithibuilders.com/"
};

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
      console.log('\n======================================================');
      console.log('📱 SCAN THIS QR CODE WITH YOUR WHATSAPP BUSINESS APP:');
      console.log('1. Open WhatsApp Business on your phone');
      console.log('2. Tap Settings (or 3 dots) -> Linked Devices -> Link a Device');
      console.log('3. Point your camera at this terminal screen or visit /qr');
      console.log('======================================================\n');
      qrcodeTerminal.generate(qr, { small: true });
    }

    if (connection === 'close') {
      isConnected = false;
      const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Connection closed due to:', lastDisconnect?.error, ', reconnecting:', shouldReconnect);
      if (shouldReconnect) {
        connectToWhatsApp();
      }
    } else if (connection === 'open') {
      isConnected = true;
      currentQR = null;
      console.log('\n🚀 Pixelvaan AI WhatsApp Bot is CONNECTED and LIVE!');
      console.log(`🛡️ Existing contacts protected: ${ignoredChats.size} chats will NEVER receive automated messages.`);
      console.log('Watching for NEW ad leads only...\n');
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messaging-history.set', ({ chats }) => {
    if (chats) {
      let count = 0;
      for (const c of chats) {
        if (c.id && !c.id.endsWith('@g.us') && !ignoredChats.has(c.id)) {
          ignoredChats.add(c.id);
          count++;
        }
      }
      if (count > 0) {
        saveIgnoredChats();
      }
    }
  });

  sock.ev.on('chats.set', ({ chats }) => {
    if (chats) {
      let count = 0;
      for (const c of chats) {
        if (c.id && !c.id.endsWith('@g.us') && !ignoredChats.has(c.id)) {
          ignoredChats.add(c.id);
          count++;
        }
      }
      if (count > 0) {
        saveIgnoredChats();
      }
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    try {
      const msg = m.messages[0];
      if (!msg.message) return;

      const remoteJid = msg.key.remoteJid;
      if (!remoteJid || remoteJid.endsWith('@g.us')) return;

      // Safeguard 1: If you send a message, mute bot for this person
      if (msg.key.fromMe) {
        if (!ignoredChats.has(remoteJid)) {
          console.log(`[Manual Chat Detected] You chatted with ${remoteJid}. Bot will NEVER auto-reply to this person.`);
          ignoredChats.add(remoteJid);
          saveIgnoredChats();
        }
        return;
      }

      // Safeguard 2: Existing contacts ignored
      if (ignoredChats.has(remoteJid)) {
        return;
      }

      const text = msg.message.conversation ||
                   msg.message.extendedTextMessage?.text ||
                   msg.message.imageMessage?.caption ||
                   '';

      if (!text.trim()) return;

      console.log(`[NEW AD LEAD from ${remoteJid}]: ${text}`);

      const session = getSession(remoteJid);
      session.lastInteraction = Date.now();

      const lowerText = text.toLowerCase();

      // Handle Sample/Demo requests
      if (lowerText.includes('sample') || lowerText.includes('demo') || lowerText.includes('portfolio') || lowerText.includes('example') || lowerText.includes('link')) {
        await sock.sendMessage(remoteJid, {
          text: `Here are demo websites built with our modern technology:\n👉 ${KNOWLEDGE.samples}\n\nWe customize the design with your brand colors, photos, and WhatsApp ordering.\n\nWhat is your business or shop name so we can design a mockup for you?`
        });
        return;
      }

      // Handle "What's the catch?" / Trust questions
      if (lowerText.includes('catch') || lowerText.includes('fake') || lowerText.includes('real') || lowerText.includes('hidden') || lowerText.includes('trust')) {
        await sock.sendMessage(remoteJid, {
          text: `There is absolutely no catch! 😊\n\n₹5,999 covers:\n✅ Complete 5-Page Business Website\n✅ 1 Year Free High-Speed Hosting\n✅ Free SSL Security\n✅ Mobile & Tablet Optimization\n\nNo hidden fees. We offer this introductory pricing to build strong client relationships and get referrals in India.\n\nWould you like to start your website setup today?`
        });
        return;
      }

      // Handle Pricing questions
      if (lowerText.includes('price') || lowerText.includes('cost') || lowerText.includes('charges') || lowerText.includes('how much') || lowerText.includes('discount')) {
        await sock.sendMessage(remoteJid, {
          text: `Our complete business website package is ₹5,999 all-inclusive.\n\n• Hosting: 1 Year Included (Free)\n• SSL Certificate: Included (Free)\n• Delivery: Live in 48 Hours\n\nTo lock in this price, please share your Business Name and the type of business you run.`
        });
        return;
      }

      // First time interaction / Stage NEW
      if (session.stage === 'NEW') {
        session.stage = 'QUALIFYING';
        await sock.sendMessage(remoteJid, {
          text: `Hello! 👋 Welcome to Pixelvaan.\n\nWe build clean, fast business websites for just ₹5,999 (includes 1-year free hosting, domain setup, mobile design & SSL).\n\nTo check if your project qualifies for our 48-hour delivery slot, please reply with:\n\n1. Your Business or Brand Name:\n2. What type of business is it? (Shop / Service / Clinic / Brand)\n3. Do you have a logo & photos ready?\n\nWe only onboard 3 clients this week to guarantee 48-hour delivery. Share your details to reserve your slot!`
        });
        return;
      }

      // User replied to qualification
      if (session.stage === 'QUALIFYING') {
        session.stage = 'QUALIFIED';
        await sock.sendMessage(remoteJid, {
          text: `Thank you for sharing your details! 👍\n\nYour business is eligible for our ₹5,999 package with 48-Hour priority delivery.\n\nHere is how we get started:\n1. 50% advance (₹2,999) to begin hosting, domain & staging setup.\n2. Send your logo, photos, and contact info.\n3. First live draft ready in 48 hours for your review.\n\nShould we send our official UPI payment link to confirm your slot?`
        });
        return;
      }

      // Payment / Start confirmation
      if (lowerText.includes('yes') || lowerText.includes('send') || lowerText.includes('upi') || lowerText.includes('pay') || lowerText.includes('start') || lowerText.includes('ok') || lowerText.includes('okay')) {
        await sock.sendMessage(remoteJid, {
          text: `Great! Our team has been notified. We will share the UPI payment details and onboarding sheet right here in a moment.\n\nThank you for choosing Pixelvaan!`
        });
        return;
      }

      // Default supportive response
      await sock.sendMessage(remoteJid, {
        text: `Thank you for your message! Our team lead at Pixelvaan will respond to you shortly.\n\nIn the meantime, feel free to check our live preview:\n👉 ${KNOWLEDGE.samples}`
      });

    } catch (err) {
      console.error('Error handling incoming message:', err);
    }
  });
}

connectToWhatsApp();

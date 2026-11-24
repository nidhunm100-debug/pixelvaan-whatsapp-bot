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
      <head><title>Pixelvaan WhatsApp Sales AI</title></head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 50px; background: #f8f9fa;">
        <div style="max-width: 600px; margin: auto; background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.08);">
          <h2 style="color: #128C7E;">Pixelvaan 30-Year Veteran Sales AI</h2>
          <p>Status: <strong style="color: ${isConnected ? '#25D366' : '#E53E3E'};">${isConnected ? '🟢 CONNECTED & QUALIFYING LEADS 24/7' : '🟡 WAITING FOR QR SCAN'}</strong></p>
          <div style="background: #E8F5E9; padding: 15px; border-radius: 8px; text-align: left; font-size: 14px; color: #2E7D32;">
            <strong>🎯 Sales Veteran Core Active:</strong>
            <ul style="margin: 8px 0 0 20px; padding: 0;">
              <li>Strict Ad-Only: Zero interference with friends/family/existing chats.</li>
              <li>Consultative Qualification: Converts "I'll tell you later" into committed slots.</li>
              <li>Value-Driven Objection Handling: Closes on ₹5,999 (50% advance / 50% on satisfaction).</li>
              <li>Curated Work Delivery: Validates business type before handing over to human designer.</li>
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

// Track human muted users (when business owner chats manually)
const mutedUsers = new Map(); // jid -> timestamp until muted

// User conversation state
const userSessions = new Map();

function getSession(jid) {
  if (!userSessions.has(jid)) {
    userSessions.set(jid, {
      stage: 'NEW',
      lastInteraction: Date.now(),
      businessName: null,
      businessType: null
    });
  }
  return userSessions.get(jid);
}

// Helper to simulate natural human typing delay
async function humanReply(sock, remoteJid, text, delayMs = 2500) {
  try {
    await sock.sendPresenceUpdate('composing', remoteJid);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await sock.sendPresenceUpdate('paused', remoteJid);
    await sock.sendMessage(remoteJid, { text });
  } catch (err) {
    console.error('Error sending human reply:', err);
  }
}

// Exact Meta Ad Detection Function
function isMessageFromMetaAd(msg, text) {
  const contextInfo = msg.message?.extendedTextMessage?.contextInfo ||
                      msg.message?.imageMessage?.contextInfo ||
                      msg.message?.contextInfo;

  // 1. Meta attaches externalAdReply when someone clicks a Click-to-WhatsApp ad
  if (contextInfo?.externalAdReply) {
    console.log('[Ad Signal] Detected externalAdReply metadata from Meta Ad!');
    return true;
  }

  // 2. Meta attaches sourceId / conversionData from CTWA ads
  if (contextInfo?.conversionData || contextInfo?.sourceId) {
    console.log('[Ad Signal] Detected CTWA conversion metadata!');
    return true;
  }

  // 3. Exact icebreaker / trigger text configured in your Meta Ad creative
  const lower = text.toLowerCase().trim();
  const adIcebreakers = [
    'ನಿಮ್ಮ ವ್ಯಾಪಾರದ ಕುರಿತು ನಾನು ಇನ್ನಷ್ಟು ತಿಳಿದುಕೊಳ್ಳಬಹುದೇ',
    'ನಿಮ್ಮ ಜಾಹೀರಾತಿನ ಕುರಿತು ನೀವು ನನಗೆ ಇನ್ನಷ್ಟು ಹೇಳಬಹುದೇ',
    'ಯಾರಾದರೂ ಚಾಟ್ ಮಾಡಲು ಲಭ್ಯವಿರುವರೇ',
    'can i learn more about your business',
    'can you tell me more about your ad',
    'is anyone available to chat',
    '5999', '₹5,999', 'pixelvaan', 'what\'s the catch', 'website package'
  ];

  if (adIcebreakers.some(trigger => lower.includes(trigger.toLowerCase()))) {
    console.log('[Ad Signal] Detected Ad-specific icebreaker/trigger text!');
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
      console.log('Connection closed, reconnecting:', shouldReconnect);
      if (shouldReconnect) {
        connectToWhatsApp();
      }
    } else if (connection === 'open') {
      isConnected = true;
      currentQR = null;
      console.log('\n🚀 Pixelvaan 30-Year Veteran Sales AI is LIVE!');
      console.log('🎯 STRICT AD-ONLY MODE: Zero automated messages to friends/family.');
      console.log('💼 CONSULTATIVE SALES ENGINE: Empathetic, authoritative, closing-oriented.\n');
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async (m) => {
    try {
      const msg = m.messages[0];
      if (!msg.message) return;

      const remoteJid = msg.key.remoteJid;
      if (!remoteJid || remoteJid.endsWith('@g.us')) return; // Ignore groups

      // If business owner manually chats from their phone, mute bot for 24 hours
      if (msg.key.fromMe) {
        console.log(`[Human Takeover] Owner replied to ${remoteJid}. Muting bot for 24h.`);
        mutedUsers.set(remoteJid, Date.now() + 24 * 60 * 60 * 1000);
        return;
      }

      // Check if muted by human owner
      if (mutedUsers.has(remoteJid) && Date.now() < mutedUsers.get(remoteJid)) {
        return;
      }

      const text = msg.message.conversation ||
                   msg.message.extendedTextMessage?.text ||
                   msg.message.imageMessage?.caption ||
                   '';

      if (!text.trim()) return;

      const isKnownAdLead = confirmedAdLeads.has(remoteJid);

      // 🛑 STRICT AD CHECK: Only trigger on people arriving from the Meta Ad!
      if (!isKnownAdLead) {
        if (!isMessageFromMetaAd(msg, text)) {
          // NOT an ad lead (Friend, family, normal contact) -> SILENT IGNORE!
          return;
        }

        // Confirmed new lead from Meta Ad!
        console.log(`[🎯 NEW AD LEAD from ${remoteJid}]: ${text}`);
        confirmedAdLeads.add(remoteJid);
        saveAdLeads();
      }

      const session = getSession(remoteJid);
      session.lastInteraction = Date.now();
      const lower = text.toLowerCase().trim();

      // -------------------------------------------------------------
      // 1. "I will tell you later" / "Kal batata hoon" / Hesitation Killer
      // -------------------------------------------------------------
      if (
        lower.includes('later') ||
        lower.includes('baad') ||
        lower.includes('badme') ||
        lower.includes('kal') ||
        lower.includes('after some time') ||
        lower.includes('busy right now') ||
        lower.includes('thinking') ||
        lower.includes('not now') ||
        lower.includes('soch ke')
      ) {
        await humanReply(
          sock,
          remoteJid,
          `Totally understand! Take all the time you need. 👍\n\nJust a quick heads-up from my side: because we build custom websites and guarantee live delivery in 48 hours, our design team only takes on 3 new clients each week so quality never slips.\n\nIf you're planning to get your website up soon, just drop your Business Name or what you sell right here, and I'll hold your ₹5,999 introductory pricing slot until tomorrow evening. Sound fair?`
        );
        return;
      }

      // -------------------------------------------------------------
      // 2. Samples / Works / Portfolio / Demo / Previous Designs
      // -------------------------------------------------------------
      if (
        lower.includes('work') ||
        lower.includes('works') ||
        lower.includes('sample') ||
        lower.includes('samples') ||
        lower.includes('demo') ||
        lower.includes('portfolio') ||
        lower.includes('project') ||
        lower.includes('projects') ||
        lower.includes('example') ||
        lower.includes('examples') ||
        lower.includes('previous') ||
        lower.includes('design') ||
        lower.includes('designs') ||
        lower.includes('kaam') ||
        lower.includes('kuch dikhao')
      ) {
        await humanReply(
          sock,
          remoteJid,
          `I would love to show you! We have built dozens of websites for businesses across India. 😊\n\nRather than dumping random templates on you that have nothing to do with what you do, let me ask: what kind of business do you run? (Retail shop, clinic, service, manufacturing, consulting, etc.)\n\nTell me your business type and name, and I will personally pick 2 or 3 live websites in your exact field so you can see real results.`
        );
        return;
      }

      // -------------------------------------------------------------
      // 3. "What's the catch?" / Trust / Fake / Real / Hidden charges
      // -------------------------------------------------------------
      if (
        lower.includes('catch') ||
        lower.includes('fake') ||
        lower.includes('real') ||
        lower.includes('hidden') ||
        lower.includes('trust') ||
        lower.includes('fraud') ||
        lower.includes('scam') ||
        lower.includes('why so cheap') ||
        lower.includes('how possible')
      ) {
        await humanReply(
          sock,
          remoteJid,
          `I get asked this every single day, and I genuinely respect the honesty! Here is the straight truth from 30 years in business:\n\nMost agencies charge ₹25,000 to ₹40,000 because they carry huge office overheads and push bloated features that small businesses never need. We don't do that.\n\nFor ₹5,999 flat, you get:\n✅ Complete 5-Page Fast Business Website\n✅ 1 Full Year High-Speed Cloud Hosting\n✅ Free SSL Security Certificate\n✅ Mobile & Tablet Responsive Layout\n✅ Direct WhatsApp Call/Order Button\n\nOur strategy is simple: if we deliver you an incredible website in 48 hours at an unbeatable price, you'll be thrilled and refer your business friends to us. It's a win-win.\n\nWhat business are you looking to build the website for?`
        );
        return;
      }

      // -------------------------------------------------------------
      // 4. Pricing / Cost / How much / Charges / Discount
      // -------------------------------------------------------------
      if (
        lower.includes('price') ||
        lower.includes('cost') ||
        lower.includes('charges') ||
        lower.includes('how much') ||
        lower.includes('discount') ||
        lower.includes('rate') ||
        lower.includes('kitna')
      ) {
        await humanReply(
          sock,
          remoteJid,
          `It is ₹5,999 flat, all-inclusive. Not a single rupee in hidden fees.\n\nThat covers the entire design, setup, 1 full year of cloud hosting, and SSL security. Plus, your first live draft is ready to review in 48 hours.\n\nWhat is your business name and what products or services do you offer? Let me check our onboarding availability for this week.`
        );
        return;
      }

      // -------------------------------------------------------------
      // 5. Payment / Ready to Start / Send UPI / Yes / OK
      // -------------------------------------------------------------
      if (
        lower.includes('yes') ||
        lower.includes('send upi') ||
        lower.includes('upi') ||
        lower.includes('pay') ||
        lower.includes('payment') ||
        lower.includes('account details') ||
        lower.includes('start now') ||
        lower.includes('proceed') ||
        lower.includes('ok send') ||
        lower.includes('ha bhejo')
      ) {
        session.stage = 'PAYMENT_PENDING';
        await humanReply(
          sock,
          remoteJid,
          `Excellent decision! You're taking a big step for your business credibility.\n\nHere is our simple onboarding process:\n1. 50% advance (₹2,999) to allocate your cloud hosting server and lock in your 48-hour delivery slot.\n2. Send us your logo, photos, and contact info right here on WhatsApp.\n3. We deliver your live draft in 48 hours. The remaining 50% is only payable after you review and approve everything.\n\nOur team lead is preparing your official invoice and UPI payment details right now. They will share it directly here in just a moment!`
        );
        return;
      }

      // -------------------------------------------------------------
      // 6. First touch / Brand new lead from ad (Stage NEW)
      // -------------------------------------------------------------
      if (session.stage === 'NEW') {
        session.stage = 'QUALIFYING';
        await humanReply(
          sock,
          remoteJid,
          `Hello! Thanks for reaching out. Glad you saw our ad! 👋\n\nWe build clean, high-converting business websites for ₹5,999 all-inclusive (1 year of free cloud hosting + SSL security included, delivered live in 48 hours).\n\nQuick question so I can steer you right: What is the name of your business, and what do you guys do? Just want to see what style fits your brand best.`
        );
        return;
      }

      // -------------------------------------------------------------
      // 7. Lead replied with details (Stage QUALIFYING -> QUALIFIED)
      // -------------------------------------------------------------
      if (session.stage === 'QUALIFYING') {
        session.stage = 'QUALIFIED';
        await humanReply(
          sock,
          remoteJid,
          `That sounds like a fantastic business! A clean, modern website with a direct WhatsApp customer button will do wonders for your credibility and customer trust.\n\nYour project qualifies for our ₹5,999 package and our priority 48-hour delivery.\n\nHere is how we get started:\n• 50% advance (₹2,999) to begin domain, hosting setup, and layout design.\n• Send your photos/logo right here.\n• First draft live in 48 hours. Remaining 50% only when you are 100% satisfied.\n\nShall I send our official UPI payment details so we can lock in your slot for this week?`
        );
        return;
      }

      // -------------------------------------------------------------
      // 8. Lead is already qualified and continuing conversation
      // -------------------------------------------------------------
      if (session.stage === 'QUALIFIED') {
        await humanReply(
          sock,
          remoteJid,
          `Got it! Our lead website designer is reviewing your message right now and will personally reply here in just a moment.\n\nIf you want to secure your 48-hour priority delivery slot right away, just say "Yes, send UPI" and we will send the onboarding details!`
        );
        return;
      }

      // -------------------------------------------------------------
      // 9. Default supportive consultative response
      // -------------------------------------------------------------
      await humanReply(
        sock,
        remoteJid,
        `Thank you for messaging Pixelvaan! Our team lead is reviewing our chat right now and will follow up with you directly here in a moment.`
      );

    } catch (err) {
      console.error('Error handling incoming message:', err);
    }
  });
}

connectToWhatsApp();

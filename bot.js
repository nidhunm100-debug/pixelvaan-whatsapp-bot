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
          <h2 style="color: #128C7E;">Pixelvaan Indian Business Sales AI</h2>
          <p>Status: <strong style="color: ${isConnected ? '#25D366' : '#E53E3E'};">${isConnected ? '🟢 CONNECTED & QUALIFYING LEADS 24/7' : '🟡 WAITING FOR QR SCAN'}</strong></p>
          <div style="background: #E8F5E9; padding: 15px; border-radius: 8px; text-align: left; font-size: 14px; color: #2E7D32;">
            <strong>🎯 Natural Indian Tone Active:</strong>
            <ul style="margin: 8px 0 0 20px; padding: 0;">
              <li>Super simple, respectful words that every Indian business owner easily understands.</li>
              <li>No tough English or complex jargon.</li>
              <li>Smooth objection handling for "Later / Kal batata hu" and "What's the catch".</li>
              <li>Strict Ad-Only: Zero messages to friends or family.</li>
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
const mutedUsers = new Map();

// User conversation state
const userSessions = new Map();

function getSession(jid) {
  if (!userSessions.has(jid)) {
    userSessions.set(jid, {
      stage: 'NEW',
      lastInteraction: Date.now()
    });
  }
  return userSessions.get(jid);
}

// Helper to simulate natural human typing delay
async function humanReply(sock, remoteJid, text, delayMs = 2000) {
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
    return true;
  }

  // 2. Meta attaches sourceId / conversionData from CTWA ads
  if (contextInfo?.conversionData || contextInfo?.sourceId) {
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
    '5999', '₹5,999', 'pixelvaan', 'what\'s the catch', 'website package',
    'website chahiye', 'website banana hai', 'website offer', 'sample'
  ];

  if (adIcebreakers.some(trigger => lower.includes(trigger.toLowerCase()))) {
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
      console.log('🚀 Pixelvaan Indian Business Sales AI is LIVE & CONNECTED!');
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
      // 1. "I will tell you later" / "Kal batata hu" / "Baad me"
      // -------------------------------------------------------------
      if (
        lower.includes('later') ||
        lower.includes('baad') ||
        lower.includes('badme') ||
        lower.includes('kal') ||
        lower.includes('after') ||
        lower.includes('busy') ||
        lower.includes('soch') ||
        lower.includes('not now')
      ) {
        await humanReply(
          sock,
          remoteJid,
          `Koi baat nahi sir, bilkul aaram se soch lijiye! 👍\n\nBas ek chhota sa update: Hamari team ek hafte me sirf 3-4 website hi banati hai taki 48 hours me perfect kaam deliver ho sake.\n\nAgar aapko ₹5,999 wale offer me apna slot book karke rakhna hai, to bas apne business ka naam bata dijiye. Main kal tak aapka rate hold karke rakhunga. Theek hai sir?`
        );
        return;
      }

      // -------------------------------------------------------------
      // 2. Samples / Works / Portfolio / "Kaam dikhao"
      // -------------------------------------------------------------
      if (
        lower.includes('work') ||
        lower.includes('sample') ||
        lower.includes('demo') ||
        lower.includes('portfolio') ||
        lower.includes('project') ||
        lower.includes('example') ||
        lower.includes('design') ||
        lower.includes('kaam') ||
        lower.includes('dikhao') ||
        lower.includes('link')
      ) {
        await humanReply(
          sock,
          remoteJid,
          `Haan bilkul sir! Hamne alag-alag business ke liye bohot saari websites banayi hain. 👍\n\nAapko faltu ka template dikhane ke badle, aap bataiye aapka kis cheez ka business hai? (Jaise retail shop, clinic, salon, wholesale, factory, ya service?)\n\nAap bas business ka naam aur type bata dijiye, hamare main designer 2 minute me aapke business ke matching live website links yahan bhej denge.`
        );
        return;
      }

      // -------------------------------------------------------------
      // 3. "What's the catch?" / "Hidden charge?" / "Is this real or fake?"
      // -------------------------------------------------------------
      if (
        lower.includes('catch') ||
        lower.includes('fake') ||
        lower.includes('real') ||
        lower.includes('hidden') ||
        lower.includes('trust') ||
        lower.includes('fraud') ||
        lower.includes('scam') ||
        lower.includes('sach') ||
        lower.includes('cheap')
      ) {
        await humanReply(
          sock,
          remoteJid,
          `Sir bilkul genuine hai, koi bhi hidden charge nahi hai! 😊\n\nPakka ₹5,999 me hi sab kuch milega:\n✅ Poori 5-Page Business Website\n✅ 1 Saal ki Free Fast Cloud Hosting\n✅ Free SSL Security (Green lock)\n✅ Mobile aur Computer dono pe fast chalegi\n✅ Direct WhatsApp Call/Chat Button\n\nBadi agencies isi cheez ka 20,000 se 30,000 maangti hain. Hum kam daam me isliye de rahe hain taki aapka kaam achha ho aur aap apne doosre businessman doston ko bhi humse connect karein.\n\nAapka business kis cheez ka hai sir?`
        );
        return;
      }

      // -------------------------------------------------------------
      // 4. Pricing / Cost / "Kitna lagega?"
      // -------------------------------------------------------------
      if (
        lower.includes('price') ||
        lower.includes('cost') ||
        lower.includes('charge') ||
        lower.includes('kitna') ||
        lower.includes('discount') ||
        lower.includes('rate') ||
        lower.includes('paisa')
      ) {
        await humanReply(
          sock,
          remoteJid,
          `Sir total ₹5,999 flat hai, koi extra charge nahi hai.\n\nIsme website design, 1 saal ki cloud hosting, aur SSL security sab included hai. Aur sabse achhi baat: 48 hours me aapka pehla draft live ready ho jayega.\n\nAapke business ka naam kya hai sir?`
        );
        return;
      }

      // -------------------------------------------------------------
      // 5. Payment / Ready / "Yes" / "UPI bhejo" / "Start karo"
      // -------------------------------------------------------------
      if (
        lower.includes('yes') ||
        lower.includes('upi') ||
        lower.includes('pay') ||
        lower.includes('payment') ||
        lower.includes('bhejo') ||
        lower.includes('start') ||
        lower.includes('shuru') ||
        lower.includes('account') ||
        lower.includes('send') ||
        lower.includes('ok') ||
        lower.includes('theek') ||
        lower.includes('done')
      ) {
        session.stage = 'PAYMENT_PENDING';
        await humanReply(
          sock,
          remoteJid,
          `Bohot badhiya sir! Bohot achha decision hai aapke business ke liye. 🤝\n\nKaam shuru karne ka process bilkul aasan hai:\n1. 50% advance (₹2,999) se hosting aur server setup start hota hai.\n2. Aap apna photo, logo aur details yahan WhatsApp pe share kar dijiye.\n3. 48 hours me hum aapko live website link bhejenge dekhne ke liye.\nBaqi 50% tabhi dena hai jab aap poori tarah se website dekh kar khush honge!\n\nHamare team lead abhi official UPI details aur basic sheet yahan bhej rahe hain 2 minute me.`
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
          `Namaste! Pixelvaan me aapka swagat hai. 🙏\n\nHum local businesses ke liye fast aur sundar websites banate hain sirf ₹5,999 me (1 saal free hosting + SSL security ke saath, 48 hours me live).\n\nAapke business ke hisaab se sahi design batane ke liye: Aapke business ka naam kya hai aur aap kis cheez ka kaam karte hain sir?`
        );
        return;
      }

      // -------------------------------------------------------------
      // 7. Lead replied with business details (Stage QUALIFYING -> QUALIFIED)
      // -------------------------------------------------------------
      if (session.stage === 'QUALIFYING') {
        session.stage = 'QUALIFIED';
        await humanReply(
          sock,
          remoteJid,
          `Bohot badhiya sir! Is type ke business ke liye ek clean website aur direct WhatsApp order button se customers ka trust bohot badh jata hai. 👍\n\nAapka kaam ₹5,999 wale package me 48 hours me deliver ho jayega.\n\nShuru karne ke liye:\n• 50% advance (₹2,999) se domain aur hosting setup start hota hai.\n• Aap photo/logo WhatsApp pe bhejenge.\n• 48 hours me draft live ho jayega. Baqi 50% payment aapke final approval ke baad.\n\nKya main official UPI payment details bhej doon sir slot confirm karne ke liye?`
        );
        return;
      }

      // -------------------------------------------------------------
      // 8. Lead already qualified and chatting
      // -------------------------------------------------------------
      if (session.stage === 'QUALIFIED') {
        await humanReply(
          sock,
          remoteJid,
          `Theek hai sir! Hamare senior website designer aapka message dekh rahe hain aur abhi aapse directly baat karenge. 👍\n\nAgar aapko 48 hours wala delivery slot book karna hai, to bas "Yes, UPI bhejo" reply kar dijiye!`
        );
        return;
      }

      // -------------------------------------------------------------
      // 9. Default friendly response
      // -------------------------------------------------------------
      await humanReply(
        sock,
        remoteJid,
        `Thank you sir! Hamari team aapka message dekh rahi hai aur abhi aapse directly connect karegi.`
      );

    } catch (err) {
      console.error('Error handling incoming message:', err);
    }
  });
}

connectToWhatsApp();

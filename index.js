require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const app = express();

app.use(express.json());

// تخزين مؤقت لبيانات المستخدمين
const userSessions = {};

const { 
  VERIFY_TOKEN, 
  PAGE_ACCESS_TOKEN, 
  PORT = 3000 
} = process.env;

// Middleware للتحقق من Webhook
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// معالجة الرسائل
app.post('/webhook', async (req, res) => {
  try {
    const { entry } = req.body;
    if (!entry || !entry[0].messaging) return res.sendStatus(400);

    const event = entry[0].messaging[0];
    const senderId = event.sender.id;
    const messageText = event.message?.text?.trim();

    if (!messageText) return res.sendStatus(200);

    // إدارة الحالات
    if (messageText.toLowerCase() === 'list') {
      delete userSessions[senderId];
      return sendTextMessage(senderId, "🔍 اكتب اسم المانجا للبحث");
    }

    if (userSessions[senderId]?.chapters) {
      const chapterNum = parseInt(messageText);
      if (!isNaN(chapterNum)) {
        return handleChapterRequest(senderId, chapterNum);
      }
    }

    // البحث عن مانجا جديدة
    const mangaUrl = `https://lekmanga.net/manga/${messageText.toLowerCase().replace(/ /g, '-')}/`;
    const mangaInfo = await fetchMangaInfo(mangaUrl);
    
    if (!mangaInfo) {
      return sendTextMessage(senderId, "⚠️ لم أتمكن من العثور على المانجا");
    }

    // حفظ بيانات الفصول
    userSessions[senderId] = {
      title: mangaInfo.title,
      chapters: mangaInfo.chapters
    };

    // إرسال الرد
    await sendTextMessage(senderId, 
      `📖 ${mangaInfo.title}\n` +
      `📚 عدد الفصول: ${mangaInfo.chapters.length}\n` +
      `🖼️ ${mangaInfo.coverImage ? 'تم جلب الغلاف' : 'لا يوجد غلاف'}\n\n` +
      "أرسل رقم الفصل (مثال: 1) للحصول على الصور\n" +
      "أو 'list' للعودة"
    );
    
    if (mangaInfo.coverImage) {
      await sendImage(senderId, mangaInfo.coverImage);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Error:', error);
    res.sendStatus(500);
  }
});

// دالة معالجة طلب الفصل
async function handleChapterRequest(senderId, chapterNum) {
  const session = userSessions[senderId];
  if (!session) return;

  const chapter = session.chapters[chapterNum - 1];
  if (!chapter) {
    return sendTextMessage(senderId, "⚠️ رقم الفصل غير متاح!");
  }

  try {
    const images = await fetchChapterImages(chapter.url);
    if (images.length === 0) {
      return sendTextMessage(senderId, "❌ لم أجد صوراً لهذا الفصل");
    }

    await sendTextMessage(senderId, `📂 جاري إرسال صور الفصل ${chapterNum}...`);
    
    for (const imgUrl of images) {
      await sendImage(senderId, imgUrl);
      await new Promise(resolve => setTimeout(resolve, 500)); // تأخير بين الصور
    }
  } catch (error) {
    console.error('Chapter Error:', error);
    sendTextMessage(senderId, "❌ حدث خطأ أثناء جلب الصور");
  }
}

// دالة محسنة لجلب معلومات المانجا
async function fetchMangaInfo(url) {
  try {
    const { data } = await axios.get(url, {
      timeout: 10000,
      headers: { 'User-Agent': 'MangaBot/1.0' }
    });
    
    const $ = cheerio.load(data);
    
    const chapters = [];
    $('.wp-manga-chapter a').each((i, el) => {
      chapters.push({
        number: i + 1,
        url: $(el).attr('href')
      });
    });

    return {
      title: $('.post-title h1').text().trim(),
      coverImage: $('.summary_image img').attr('src') || null,
      chapters: chapters.reverse() // الأحدث أولاً
    };
  } catch (error) {
    console.error('Fetch Error:', error.message);
    return null;
  }
}

// دالة جديدة لجلب صور الفصل
async function fetchChapterImages(url) {
  try {
    const { data } = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': 'MangaBot/1.0' }
    });
    
    const $ = cheerio.load(data);
    const images = [];
    
    $('.reading-content img').each((i, el) => {
      const imgUrl = $(el).attr('src')?.trim();
      if (imgUrl) images.push(imgUrl);
    });

    return images;
  } catch (error) {
    console.error('Chapter Images Error:', error.message);
    return [];
  }
}

// إرسال رسالة نصية
async function sendTextMessage(recipientId, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/me/messages`,
      {
        recipient: { id: recipientId },
        message: { text }
      },
      {
        params: { access_token: PAGE_ACCESS_TOKEN },
        timeout: 5000
      }
    );
  } catch (error) {
    console.error('Message Error:', error.response?.data || error.message);
  }
}

// إرسال صورة
async function sendImage(recipientId, imageUrl) {
  if (!imageUrl) return;
  
  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/me/messages`,
      {
        recipient: { id: recipientId },
        message: {
          attachment: {
            type: "image",
            payload: { url: imageUrl, is_reusable: true }
          }
        }
      },
      {
        params: { access_token: PAGE_ACCESS_TOKEN },
        timeout: 10000
      }
    );
  } catch (error) {
    console.error('Image Error:', error.response?.data || error.message);
  }
}

app.listen(PORT, () => 
  console.log(`✅ البوت يعمل على المنفذ ${PORT}`)
);
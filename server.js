import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import axios from 'axios';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// In-memory chat history (for demo; consider DB in production)
let chatHistory = [];

// Helper: send AI chat request
async function askAI(question) {
  try {
    const url = `https://kaiz-apis.gleeze.com/api/gpt-4.1?ask=${encodeURIComponent(question)}&uid=1268&apikey=a0ebe80e-bf1a-4dbf-8d36-6935b1bfa5ea`;
    const res = await axios.get(url);
    if(res.data && res.data.response) return res.data.response;
    return "Sorry, AI couldn't respond.";
  } catch (e) {
    console.error('AI error:', e.message);
    return "Error contacting AI.";
  }
}

// Helper: YouTube search
async function ytSearch(query) {
  try {
    const res = await axios.get('https://kaiz-apis.gleeze.com/api/ytsearch', { params: { q: query } });
    if(res.data && res.data.results && res.data.results.length > 0) return res.data.results[0];
    return null;
  } catch (e) {
    console.error('YT Search error:', e.message);
    return null;
  }
}

// Helper: Download song mp3 URL
async function getSongUrl(videoId) {
  try {
    const res = await axios.get('https://kaiz-apis.gleeze.com/api/ytdown-mp3', { params: { v: videoId } });
    if(res.data && res.data.downloadUrl) return res.data.downloadUrl;
    return null;
  } catch (e) {
    console.error('YT MP3 error:', e.message);
    return null;
  }
}

// Helper: Download video mp4 URL
async function getVideoUrl(videoId) {
  try {
    const res = await axios.get('https://kaiz-apis.gleeze.com/api/ytmp4', { params: { v: videoId } });
    if(res.data && res.data.downloadUrl) return res.data.downloadUrl;
    return null;
  } catch (e) {
    console.error('YT MP4 error:', e.message);
    return null;
  }
}

// Helper: Generate image from prompt
async function generateImage(prompt) {
  try {
    const res = await axios.get(`https://smfahim.xyz/creartai?prompt=${encodeURIComponent(prompt)}`);
    if(res.data && res.data.imageUrl) return res.data.imageUrl;
    return null;
  } catch (e) {
    console.error('Image generation error:', e.message);
    return null;
  }
}

app.use(express.static('public')); // serve your static files (chatroom.html etc.)

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Send chat history to new user
  socket.emit('chatHistory', chatHistory);

  socket.on('message', async (data) => {
    // Expected data: { user, message, replyTo, reaction }
    let message = data.message.trim();

    // Handle AI commands that start with ".Ai"
    if(message.toLowerCase().startsWith('.ai')) {
      const command = message.substring(3).trim();

      // Special cases: send song, video, generate image
      if(/send me song/i.test(command)) {
        const query = command.replace(/send me song/i, '').trim();
        const video = await ytSearch(query);
        if(video) {
          const songUrl = await getSongUrl(video.videoId || video.id);
          if(songUrl) {
            const aiReply = `Here's your song: ${video.title}\nListen: ${songUrl}`;
            const aiMsg = { user: 'AI', message: aiReply };
            chatHistory.push(aiMsg);
            io.emit('message', aiMsg);
            return;
          }
        }
        io.emit('message', { user: 'AI', message: "Couldn't find the song." });
        return;
      }

      if(/send me video/i.test(command)) {
        const query = command.replace(/send me video/i, '').trim();
        const video = await ytSearch(query);
        if(video) {
          const videoUrl = await getVideoUrl(video.videoId || video.id);
          if(videoUrl) {
            const aiReply = `Here's your video: ${video.title}\nWatch: ${videoUrl}`;
            const aiMsg = { user: 'AI', message: aiReply };
            chatHistory.push(aiMsg);
            io.emit('message', aiMsg);
            return;
          }
        }
        io.emit('message', { user: 'AI', message: "Couldn't find the video." });
        return;
      }

      if(/generate image/i.test(command) || /create image/i.test(command)) {
        const prompt = command.replace(/generate image|create image/i, '').trim();
        const imgUrl = await generateImage(prompt || 'cute anime girl');
        if(imgUrl) {
          const aiMsg = { user: 'AI', message: `<img src="${imgUrl}" style="max-width:200px; border-radius:8px;" />` };
          chatHistory.push(aiMsg);
          io.emit('message', aiMsg);
          return;
        }
        io.emit('message', { user: 'AI', message: "Couldn't generate image." });
        return;
      }

      // Default: normal AI chat response
      const aiResponse = await askAI(command);
      const aiMsg = { user: 'AI', message: aiResponse };
      chatHistory.push(aiMsg);
      io.emit('message', aiMsg);
      return;
    }

    // Normal message, add to chat and broadcast
    const chatMsg = {
      user: data.user || 'Unknown',
      message: message,
      replyTo: data.replyTo || null,
      reactions: data.reactions || []
    };
    chatHistory.push(chatMsg);
    io.emit('message', chatMsg);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
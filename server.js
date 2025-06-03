import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import axios from 'axios';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs-extra';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Users file
const usersFile = path.join(__dirname, 'data', 'users.json');

// Ensure users file exists
if (!fs.existsSync(usersFile)) {
  fs.ensureFileSync(usersFile);
  fs.writeJsonSync(usersFile, {});
}

// Load users from file
let users = fs.readJsonSync(usersFile);

// Express session middleware
app.use(session({
  secret: 'replace_with_a_strong_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Parse JSON and form data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Middleware to protect chatroom route
function requireLogin(req, res, next) {
  if (req.session && req.session.username) {
    next();
  } else {
    res.redirect('/login');
  }
}

// Redirect root to login page
app.get('/', (req, res) => {
  if (req.session && req.session.username) {
    res.redirect('/chatroom.html');
  } else {
    res.redirect('/login');
  }
});

// Serve login page
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Serve signup page
app.get('/signup', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'signup.html'));
});

// Handle signup
app.post('/signup', (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ success: false, message: 'Missing username, email, or password' });
  }

  if (users[username]) {
    return res.status(409).json({ success: false, message: 'Username already exists. Please choose a different one.' });
  }

  users[username] = { password, email };
  fs.writeJsonSync(usersFile, users);

  res.json({ success: true, message: 'Account created successfully. You can now log in.' });
});

// Handle login
app.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Missing username or password' });
  }

  if (users[username] && users[username].password === password) {
    req.session.username = username;
    return res.json({ success: true, message: 'Login successful' });
  } else {
    return res.status(401).json({ success: false, message: 'Invalid credentials. Please try again.' });
  }
});

// Logout route
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// Protect chatroom.html route
app.get('/chatroom.html', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'chatroom.html'));
});

// --------- Chat & AI logic ---------

let chatHistory = [];

async function askAI(question) {
  try {
    const url = `https://kaiz-apis.gleeze.com/api/gpt-4.1?ask=${encodeURIComponent(question)}&uid=1268&apikey=a0ebe80e-bf1a-4dbf-8d36-6935b1bfa5ea`;
    const res = await axios.get(url);
    if (res.data && res.data.response) return res.data.response;
    return "Sorry, AI couldn't respond.";
  } catch (e) {
    console.error('AI error:', e.message);
    return "Error contacting AI.";
  }
}

async function ytSearch(query) {
  try {
    const res = await axios.get('https://kaiz-apis.gleeze.com/api/ytsearch', { params: { q: query } });
    if (res.data && res.data.results && res.data.results.length > 0) return res.data.results[0];
    return null;
  } catch (e) {
    console.error('YT Search error:', e.message);
    return null;
  }
}

async function getSongUrl(videoId) {
  try {
    const res = await axios.get('https://kaiz-apis.gleeze.com/api/ytdown-mp3', { params: { v: videoId } });
    if (res.data && res.data.downloadUrl) return res.data.downloadUrl;
    return null;
  } catch (e) {
    console.error('YT MP3 error:', e.message);
    return null;
  }
}

async function getVideoUrl(videoId) {
  try {
    const res = await axios.get('https://kaiz-apis.gleeze.com/api/ytmp4', { params: { v: videoId } });
    if (res.data && res.data.downloadUrl) return res.data.downloadUrl;
    return null;
  } catch (e) {
    console.error('YT MP4 error:', e.message);
    return null;
  }
}

async function generateImage(prompt) {
  try {
    const res = await axios.get(`https://smfahim.xyz/creartai?prompt=${encodeURIComponent(prompt)}`);
    if (res.data && res.data.imageUrl) return res.data.imageUrl;
    return null;
  } catch (e) {
    console.error('Image generation error:', e.message);
    return null;
  }
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.emit('chatHistory', chatHistory);

  socket.on('message', async (data) => {
    let message = data.message.trim();

    if (message.toLowerCase().startsWith('.ai')) {
      const command = message.substring(3).trim();

      if (/send me song/i.test(command)) {
        const query = command.replace(/send me song/i, '').trim();
        const video = await ytSearch(query);
        if (video) {
          const songUrl = await getSongUrl(video.videoId || video.id);
          if (songUrl) {
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

      if (/send me video/i.test(command)) {
        const query = command.replace(/send me video/i, '').trim();
        const video = await ytSearch(query);
        if (video) {
          const videoUrl = await getVideoUrl(video.videoId || video.id);
          if (videoUrl) {
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

      if (/generate image|create image/i.test(command)) {
        const prompt = command.replace(/generate image|create image/i, '').trim();
        const imgUrl = await generateImage(prompt || 'cute anime girl');
        if (imgUrl) {
          const aiMsg = { user: 'AI', message: `<img src="${imgUrl}" style="max-width:200px; border-radius:8px;" />` };
          chatHistory.push(aiMsg);
          io.emit('message', aiMsg);
          return;
        }
        io.emit('message', { user: 'AI', message: "Couldn't generate image." });
        return;
      }

      const aiResponse = await askAI(command);
      const aiMsg = { user: 'AI', message: aiResponse };
      chatHistory.push(aiMsg);
      io.emit('message', aiMsg);
      return;
    }

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
  console.log(`✅ Server listening on port ${PORT}`);
});
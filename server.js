import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import axios from 'axios';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs-extra';
import bcrypt from 'bcrypt';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const saltRounds = 10;

// Users file path
const usersFile = path.join(__dirname, 'data', 'users.json');

// Ensure users file exists and load users
if (!fs.existsSync(usersFile)) {
  fs.ensureFileSync(usersFile);
  fs.writeJsonSync(usersFile, {});
}

let users = {};
(async () => {
  try {
    users = await fs.readJson(usersFile);
  } catch {
    users = {};
  }
})();

// Chat history array in memory
const chatHistory = [];

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'replace_with_a_strong_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000, httpOnly: true, secure: false }
});
app.use(sessionMiddleware);

// Share session with socket.io
io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

// Middleware to require login
function requireLogin(req, res, next) {
  if (req.session && req.session.username) {
    next();
  } else {
    res.redirect('/login');
  }
}

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/signup', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'signup.html'));
});

app.get('/chatroom.html', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'chatroom.html'));
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// Signup route
app.post('/signup', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ success: false, message: 'Missing username, email, or password' });
  }
  if (users[username]) {
    return res.status(409).json({ success: false, message: 'Username already exists. Please choose a different one.' });
  }
  try {
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    users[username] = { password: hashedPassword, email };
    await fs.writeJson(usersFile, users);
    res.json({ success: true, message: 'Account created.error('Signup error:', e);
    res.status(500).json({ success: false, message: 'Server error during signup.' });
  }
});

// Login route
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Missing username or password' });
  }
  try {
    const user = users[username];
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials. Please try again.' });
    }
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ success: false, message: 'Invalid credentials. Please try again.' });
    }
    req.session.username = username;
    res.json({ success: true, message: 'Login successful' });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ success: false, message: 'Unable to connect to the server. Please try again later.' });
  }
});

// Socket.io connection and chat handling
io.on('connection', (socket) => {
  const session = socket.request.session;
  if (!session || !session.username) {
    console.log('Unauthenticated socket tried to connect:', socket.id);
    return socket.disconnect(true);
  }

  const username = session.username;
  console.log(`User connected: ${username} (${socket.id})`);

  // Send chat history to newly connected client
  socket.emit('chatHistory', chatHistory);

  socket.on('message', async (data) => {
    let message = data.message.trim();

    // AI Command
    if (message.toLowerCase().startsWith('.ai')) {
      try {
        const question = message.substring(3).trim();
        if (!question) {
          socket.emit('message', { user: 'System', message: 'Please provide a question after ".ai".' });
          return;
        }

        const response = await axios.get(`https://kaiz-apis.gleeze.com/api/gpt-4.1?ask=${encodeURIComponent(question)}&uid=1268&apikey=a0ebe80e-bf1a-4dbf-8d36-6935b1bfa5ea`);
        socket.emit('message', { user: 'Michiko AI', message: response.data.response });
      } catch (error) {
        console.error('AI error:', error);
        socket.emit('message', { user: 'System', message: 'AI service is temporarily unavailable.' });
      }
      return;
    }

    // Play Command
    if (message.toLowerCase().startsWith('.play')) {
      try {
        const song = message.substring(5).trim();
        if (!song) {
          socket.emit('message', { user: 'System', message: 'Please provide a song name after ".play".' });
          return;
        }

        const searchResponse = await axios.get(`https://kaiz-apis.gleeze.com/api/ytsearch?q=${encodeURIComponent(song)}`);
        const songUrl = searchResponse.data.results[0]?.url;
        if (!songUrl) {
          socket.emit('message', { user: 'System', message: 'Song not found.' });
          return;
        }

        const downloadResponse = await axios.get(`https://kaiz-apis.gleeze.com/api/ytdown-mp3?url=${encodeURIComponent(songUrl)}`);
        socket.emit('message', { user: 'Michiko AI', message: `Download your song here: ${downloadResponse.data.download}` });
      } catch (error) {
        console.error('Play command error:', error);
        socket.emit('message', { user: 'System', message: 'Unable to process your request. Try again later.' });
      }
      return;
    }

    // Video Command
    if (message.toLowerCase().startsWith('.video')) {
      try {
        const videoQuery = message.substring(6).trim();
        if (!videoQuery) {
          socket.emit('message', { user: 'System', message: 'Please provide a video name after ".video".' });
          return;
        }

        const searchResponse = await axios.get(`https://kaiz-apis.gleeze.com/api/ytsearch?q=${encodeURIComponent(videoQuery)}`);
        const videoUrl = searchResponse.data.results[0]?.url;
        if (!videoUrl) {
          socket.emit('message', { user: 'System', message: 'Video not found.' });
          return;
        }

        const downloadResponse = await axios.get(`https://kaiz-apis.gleeze.com/api/ytmp4?url=${encodeURIComponent(videoUrl)}`);
        socket.emit('message', { user: 'Michiko AI', message: `Download your video here: ${downloadResponse.data.download}` });
      } catch (error) {
        console.error('Video command error:', error);
        socket.emit('message', { user: 'System', message: 'Unable to process your request. Try again later.' });
      }
      return;
    }

    // Image Generation
    if (message.toLowerCase().startsWith('.image')) {
      try {
        const prompt = message.substring(6).trim();
        if (!prompt) {
          socket.emit('message', { user: 'System', message: 'Please provide a prompt after ".image".' });
          return;
        }

        const response = await axios.get(`https://smfahim.xyz/creartai?prompt=${encodeURIComponent(prompt)}`);
        socket.emit('message', { user: 'Michiko AI', message: `Here is your generated image: ${response.data.url}` });
      } catch (error) {
        console.error('Image generation error:', error);
        socket.emit('message', { user: 'System', message: 'Unable to generate image at this time.' });
      }
      return;
    }

    // Lyrics Generation
    if (message.toLowerCase().startsWith('.lyrics')) {
      try {
        const songTitle = message.substring(7).trim();
        if (!songTitle) {
          socket.emit('message', { user: 'System', message: 'Please provide a song title after ".lyrics".' });
          return;
        }

        const response = await axios.get(`https://kaiz-apis.gleeze.com/api/shazam-lyrics?title=${encodeURIComponent(songTitle)}&apikey=a0ebe80e-bf1a-4dbf-8d36-6935b1bfa5ea`);
        socket.emit('message', { user: 'Michiko AI', message: response.data.lyrics || 'Lyrics not found.' });
      } catch (error) {
        console.error('Lyrics generation error:', error);
        socket.emit('message', { user: 'System', message: 'Unable to fetch lyrics at this time.' });
      }
      return;
    }

    // Normal chat message
    const chatMsg = {
      user: username,
      message,
      replyTo: data.replyTo || null,
      reactions: []
    };

    chatHistory.push(chatMsg);
    io.emit('message', chatMsg);
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${username} (${socket.id})`);
  });
});

server.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
});
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');
const fetch = require('node-fetch');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({ secret: 'supersecretkey', saveUninitialized: true, resave: true }));

// Store users, chat history, and reactions
const users = {}; // Example: { "john": "password123" }
let chatHistory = [];
let reactions = {}; // Example: { messageId: ['😊', '❤️'] }

// Routes
app.get('/', (req, res) => {
    if (req.session.username) {
        res.redirect('/chatroom.html');
    } else {
        res.redirect('/signup.html');
    }
});

// Signup/Login Handler
app.post('/auth', (req, res) => {
    const { username, password, action } = req.body;

    if (action === 'signup') {
        if (users[username]) {
            return res.send('Username already exists!');
        }
        users[username] = password;
        req.session.username = username;
        return res.redirect('/chatroom.html');
    }

    if (action === 'login') {
        if (users[username] && users[username] === password) {
            req.session.username = username;
            return res.redirect('/chatroom.html');
        }
        return res.send('Invalid username or password!');
    }

    res.send('Invalid action!');
});

// Chatroom Handler
io.on('connection', (socket) => {
    const username = socket.handshake.query.username || 'Anonymous';

    console.log(`${username} connected`);
    socket.emit('chatHistory', chatHistory);

    // Notify others that a user joined
    io.emit('chatMessage', { id: generateId(), username: 'System', message: `${username} joined the chat`, timestamp: new Date().toLocaleTimeString() });

    // Handle text messages
    socket.on('chatMessage', ({ message, timestamp, replyTo }) => {
        const messageId = generateId();
        const newMessage = { id: messageId, username, message, timestamp, replyTo };

        io.emit('chatMessage', newMessage);
        chatHistory.push(newMessage);
    });

    // Handle reactions
    socket.on('reactToMessage', ({ messageId, reaction }) => {
        if (!reactions[messageId]) {
            reactions[messageId] = [];
        }
        reactions[messageId].push(reaction);
        io.emit('reaction', { messageId, reaction });
    });

    // Handle voice notes
    socket.on('voiceNote', ({ audio, timestamp }) => {
        const newVoiceNote = { id: generateId(), username, audio, timestamp };
        io.emit('voiceNote', newVoiceNote);
        chatHistory.push(newVoiceNote);
    });

    // Handle image uploads
    socket.on('image', ({ image, timestamp }) => {
        const newImageMessage = { id: generateId(), username, image, timestamp };
        io.emit('image', newImageMessage);
        chatHistory.push(newImageMessage);
    });

    // Notify others that a user left
    socket.on('disconnect', () => {
        console.log(`${username} disconnected`);
        io.emit('chatMessage', { id: generateId(), username: 'System', message: `${username} left the chat`, timestamp: new Date().toLocaleTimeString() });
    });
});

// Helper function to generate unique IDs for messages
function generateId() {
    return Math.random().toString(36).substr(2, 9);
}

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

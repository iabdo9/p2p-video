const express = require('express');
const app = express();
const server = require('http').Server(app);
const io = require('socket.io')(server);

app.use(express.static('public'));

// Store active rooms and users
const rooms = new Map();
// Store room creators
const roomCreators = new Map();
// Map socket IDs to user IDs
const socketToUser = new Map();
// Map user IDs to socket IDs
const userToSocket = new Map();

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Join a room
    socket.on('join-room', (roomId, userId) => {
        // Leave any previous rooms this socket was in
        const previousRooms = Array.from(socket.rooms).filter(r => r !== socket.id);
        previousRooms.forEach(prevRoom => {
            socket.leave(prevRoom);
        });

        // If this user was already connected with a different socket, clean up the old one
        if (userToSocket.has(userId)) {
            const oldSocketId = userToSocket.get(userId);
            if (oldSocketId !== socket.id) {
                console.log(`User ${userId} reconnecting - cleaning up old socket ${oldSocketId}`);
                socketToUser.delete(oldSocketId);
            }
        }

        // Update the mappings
        socketToUser.set(socket.id, userId);
        userToSocket.set(userId, socket.id);

        socket.join(roomId);

        // Initialize room if it doesn't exist
        if (!rooms.has(roomId)) {
            rooms.set(roomId, new Set());
            // Mark this user as the room creator
            roomCreators.set(roomId, userId);
            console.log(`User ${userId} created room ${roomId}`);
        }

        const room = rooms.get(roomId);

        // Check if room is full (max 2 users) - but allow rejoining
        if (room.size >= 2 && !room.has(userId)) {
            socket.emit('room-full');
            return;
        }

        // Add user if not already in room
        const isRejoining = room.has(userId);
        room.add(userId);

        // Notify others in the room
        socket.to(roomId).emit('user-connected', userId);

        if (isRejoining) {
            console.log(`User ${userId} rejoined room ${roomId}`);
        } else {
            console.log(`User ${userId} joined room ${roomId}`);
        }

        // Handle signaling for WebRTC
        socket.on('signal', (data) => {
            io.to(roomId).emit('signal', {
                userId: socket.id,
                signal: data.signal
            });
        });

        // Handle media status updates
        socket.on('media-status', (data) => {
            socket.to(data.roomId).emit('media-status', {
                userId: socket.id,
                video: data.video,
                audio: data.audio
            });
        });

        // Handle reconnection request
        socket.on('request-reconnect', (data) => {
            console.log(`User ${userId} requesting reconnection in room ${roomId}`);
            socket.to(roomId).emit('peer-reconnect-request', userId);
        });

        // Handle user disconnection
        socket.on('disconnect', () => {
            // Get the userId for this socket
            const disconnectedUserId = socketToUser.get(socket.id);

            if (disconnectedUserId) {
                // Only remove from room if this is still the active socket for this user
                if (userToSocket.get(disconnectedUserId) === socket.id) {
                    room.delete(disconnectedUserId);
                    userToSocket.delete(disconnectedUserId);
                }
                socketToUser.delete(socket.id);

                // Notify others in the room
                socket.to(roomId).emit('user-disconnected', disconnectedUserId);

                // Clean up empty rooms
                if (room.size === 0) {
                    rooms.delete(roomId);
                    roomCreators.delete(roomId);
                    console.log(`Room ${roomId} is empty and has been deleted`);
                }

                console.log(`User ${disconnectedUserId} left room ${roomId}`);
            }
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
const express = require('express');
const app = express();
const server = require('http').Server(app);
const io = require('socket.io')(server);
const path = require('path');

app.use(express.static('public'));

// Store active rooms and users
const rooms = new Map();
// Store room creators
const roomCreators = new Map();

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Join a room
    socket.on('join-room', (roomId, userId) => {
        socket.join(roomId);

        // Initialize room if it doesn't exist
        if (!rooms.has(roomId)) {
            rooms.set(roomId, new Set());
            // Mark this user as the room creator
            roomCreators.set(roomId, userId);
            console.log(`User ${userId} created room ${roomId}`);
        }

        const room = rooms.get(roomId);

        // Check if room is full (max 2 users)
        if (room.size >= 2) {
            socket.emit('room-full');
            return;
        }

        room.add(userId);

        // Notify others in the room
        socket.to(roomId).emit('user-connected', userId);

        console.log(`User ${userId} joined room ${roomId}`);

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

        // Handle user disconnection
        socket.on('disconnect', () => {
            const isCreator = roomCreators.get(roomId) === userId;

            // If the creator disconnects, end the session for everyone
            if (isCreator) {
                console.log(`Room creator ${userId} disconnected. Closing room ${roomId}`);

                // Notify OTHER users in the room that the session is ending (not the creator)
                socket.to(roomId).emit('session-ended');

                // Clean up the room
                room.delete(userId);
                rooms.delete(roomId);
                roomCreators.delete(roomId);

                // Get all sockets in the room and force them to leave
                const socketsInRoom = io.sockets.adapter.rooms.get(roomId);
                if (socketsInRoom) {
                    socketsInRoom.forEach(socketId => {
                        io.sockets.sockets.get(socketId)?.leave(roomId);
                    });
                }
            } else {
                // Regular user disconnection
                room.delete(userId);

                if (room.size === 0) {
                    rooms.delete(roomId);
                    roomCreators.delete(roomId);
                }
                socket.to(roomId).emit('user-disconnected', userId);
            }

            console.log(`User ${userId} left room ${roomId}`);
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
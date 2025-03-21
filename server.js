const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server);
const path = require('path');

// Statik dosyaları serve et
app.use(express.static('public'));
app.use(express.json());

// Ana sayfayı serve et
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Odalar ve kullanıcılar için veri yapısı
const rooms = {};
const users = {};

// Örnek rate limiting eklemesi
const rateLimit = {};

// Örnek oda yapısı:
// rooms = {
//   "roomId": {
//     host: "socketId",
//     users: ["socketId1", "socketId2"],
//     currentVideo: { videoUrl, videoId },
//     messages: [],
//     activeScreenShare: null  // Ekran paylaşımı yapan kullanıcının ID'si
//   }
// }

// Socket.io olayları
io.on('connection', (socket) => {
    console.log('Bir kullanıcı bağlandı');
    
    // Kullanıcı adı ayarlama
    socket.on('setUsername', (username) => {
        users[socket.id] = {
            username: username,
            currentRoom: null
        };
        socket.emit('usernameSet', username);
    });
    
    // Oda oluşturma
    socket.on('createRoom', () => {
        if (!users[socket.id]) {
            socket.emit('error', 'Lütfen önce kullanıcı adı belirleyin');
            return;
        }
        
        const roomId = Math.random().toString(36).substring(7);
        rooms[roomId] = {
            host: socket.id,
            users: [socket.id],
            currentVideo: null,
            messages: [],
            activeScreenShare: null  // Ekran paylaşımı yapan kullanıcının ID'si
        };
        
        users[socket.id].currentRoom = roomId;
        socket.join(roomId);
        socket.emit('roomCreated', roomId);
    });
    
    // Odaya katılma
    socket.on('joinRoom', (roomId) => {
        if (!users[socket.id]) {
            socket.emit('error', 'Lütfen önce kullanıcı adı belirleyin');
            return;
        }
        
        if (rooms[roomId]) {
            rooms[roomId].users.push(socket.id);
            users[socket.id].currentRoom = roomId;
            socket.join(roomId);
            socket.emit('roomJoined', roomId);
            
            // Oda bilgilerini gönder
            socket.emit('roomInfo', {
                roomId: roomId,
                currentVideo: rooms[roomId].currentVideo
            });
            
            // Odadaki diğer kullanıcılara bildir
            socket.to(roomId).emit('userJoined', {
                username: users[socket.id].username
            });
            
            // Eğer odada mevcut bir video varsa, yeni katılan kullanıcıya bildir
            if (rooms[roomId].currentVideo) {
                socket.emit('currentVideo', rooms[roomId].currentVideo);
            }
            
            // Önceki mesajları gönder
            socket.emit('previousMessages', rooms[roomId].messages);
        } else {
            socket.emit('error', 'Oda bulunamadı');
        }
    });
    
    // Mesaj gönderme
    socket.on('sendMessage', (message) => {
        const user = users[socket.id];
        if (!user || !user.currentRoom) return;
        
        // Rate limiting kontrolü
        const now = Date.now();
        if (!rateLimit[socket.id]) {
            rateLimit[socket.id] = { lastMessage: now, count: 1 };
        } else if (now - rateLimit[socket.id].lastMessage < 1000) {
            rateLimit[socket.id].count++;
            if (rateLimit[socket.id].count > 5) {
                socket.emit('error', 'Çok hızlı mesaj gönderiyorsunuz, lütfen yavaşlayın');
                return;
            }
        } else {
            rateLimit[socket.id] = { lastMessage: now, count: 1 };
        }
        
        const roomId = user.currentRoom;
        const messageData = {
            userId: socket.id,
            username: user.username,
            message: message,
            timestamp: Date.now()
        };
        
        // Mesajı odadaki tüm kullanıcılara gönder
        io.to(roomId).emit('newMessage', messageData);
        
        // Mesajı odanın geçmişine kaydet
        rooms[roomId].messages.push(messageData);
        
        // Mesaj geçmişini 100 mesajla sınırla
        if (rooms[roomId].messages.length > 100) {
            rooms[roomId].messages.shift();
        }
    });
    
    // Mevcut videoyu iste
    socket.on('getCurrentVideo', (roomId) => {
        if (rooms[roomId] && rooms[roomId].currentVideo) {
            socket.emit('currentVideo', rooms[roomId].currentVideo);
        }
    });
    
    // Video ayarlama
    socket.on('setVideo', (data) => {
        const room = rooms[data.roomId];
        if (room) {
            // Odanın mevcut videosunu güncelle
            room.currentVideo = {
                videoUrl: data.videoUrl,
                videoId: data.videoId
            };
            
            // Diğer kullanıcılara bildir
            socket.to(data.roomId).emit('videoUpdate', {
                videoUrl: data.videoUrl,
                videoId: data.videoId
            });
        }
    });
    
    // Video durumu değişikliği
    socket.on('videoStateChange', (data) => {
        const room = rooms[data.roomId];
        if (room) {
            socket.to(data.roomId).emit('videoStateUpdate', {
                state: data.state,
                currentTime: data.currentTime
            });
        }
    });
    
    // Aktif ekran paylaşımı kontrolü
    socket.on('checkActiveScreenShare', (roomId) => {
        if (rooms[roomId] && rooms[roomId].activeScreenShare) {
            socket.emit('activeScreenShare', rooms[roomId].activeScreenShare);
        }
    });
    
    // Aktif ekran paylaşımını ayarla
    socket.on('setActiveScreenShare', (data) => {
        const roomId = data.roomId;
        if (rooms[roomId]) {
            if (data.active) {
                rooms[roomId].activeScreenShare = socket.id;
            } else if (rooms[roomId].activeScreenShare === socket.id) {
                rooms[roomId].activeScreenShare = null;
            }
            
            // Odadaki diğer kullanıcılara bildir
            socket.to(roomId).emit('screenShareStatusChanged', {
                active: data.active,
                userId: data.active ? socket.id : null
            });
        }
    });
    
    // WebRTC sinyallerini ilet
    socket.on('webrtcSignal', (data) => {
        const roomId = data.roomId;
        if (rooms[roomId]) {
            // Sinyali odadaki diğer kullanıcılara ilet
            if (data.targetUserId) {
                // Belirli bir kullanıcıya sinyal gönder
                io.to(data.targetUserId).emit('webrtcSignal', {
                    ...data,
                    fromUserId: socket.id
                });
            } else {
                // Odadaki tüm diğer kullanıcılara sinyal gönder
                socket.to(roomId).emit('webrtcSignal', {
                    ...data,
                    fromUserId: socket.id
                });
            }
        }
    });
    
    // Bağlantı koptuğunda
    socket.on('disconnect', () => {
        console.log('Bir kullanıcı ayrıldı');
        
        const user = users[socket.id];
        if (user) {
            // Kullanıcının olduğu odaya ayrıldığını bildir
            if (user.currentRoom && rooms[user.currentRoom]) {
                socket.to(user.currentRoom).emit('userLeft', {
                    username: user.username
                });
                
                // Eğer ekran paylaşımı yapan kullanıcı ayrıldıysa, paylaşımı sonlandır
                if (rooms[user.currentRoom].activeScreenShare === socket.id) {
                    rooms[user.currentRoom].activeScreenShare = null;
                    socket.to(user.currentRoom).emit('screenShareStatusChanged', {
                        active: false,
                        userId: null
                    });
                }
            }
            
            // Kullanıcıyı odalardan çıkar
            for (const roomId in rooms) {
                const room = rooms[roomId];
                const index = room.users.indexOf(socket.id);
                if (index !== -1) {
                    room.users.splice(index, 1);
                    
                    // Eğer oda boşsa, odayı sil
                    if (room.users.length === 0) {
                        delete rooms[roomId];
                    }
                    // Eğer host ayrıldıysa, yeni host ata
                    else if (room.host === socket.id && room.users.length > 0) {
                        room.host = room.users[0];
                    }
                }
            }
            
            // Kullanıcıyı sil
            delete users[socket.id];
        }
    });
});

// Sunucuyu başlat
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor`);
});

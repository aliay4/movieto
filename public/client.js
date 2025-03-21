// Socket.io bağlantısı
const socket = io();

// Global değişkenler
let currentRoom = null;
let videoPlayer = document.getElementById('videoContainer');
let player = null;
let youtubeApiReady = false;
let username = null;
let rooms = {}; // Odaları takip etmek için

// WebRTC bağlantısı için gerekli değişkenler
let peerConnection;
let localStream;
let remoteStream;
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
    ]
};

// Modal ve form elemanları
const usernameModal = document.getElementById('usernameModal');
const usernameInput = document.getElementById('usernameInput');
const usernameSubmit = document.getElementById('usernameSubmit');
const messageInput = document.getElementById('messageInput');
const sendMessage = document.getElementById('sendMessage');
const chatMessages = document.getElementById('chatMessages');

// Sayfa yüklendiğinde kullanıcı adı modalını göster
window.onload = function() {
    usernameModal.style.display = 'flex';
};

// Kullanıcı adı giriş işlemi
usernameSubmit.addEventListener('click', () => {
    const name = usernameInput.value.trim();
    if (name) {
        username = name;
        socket.emit('setUsername', name);
    } else {
        showNotification('Lütfen bir kullanıcı adı girin');
    }
});

// Kullanıcı adı ayarlandığında
socket.on('usernameSet', (name) => {
    username = name;
    usernameModal.style.display = 'none';
    showNotification('Hoş geldiniz, ' + name);
});

// Mesaj gönderme
sendMessage.addEventListener('click', () => {
    const message = messageInput.value.trim();
    if (message && currentRoom) {
        socket.emit('sendMessage', message);
        messageInput.value = '';
    }
});

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const message = messageInput.value.trim();
        if (message && currentRoom) {
            socket.emit('sendMessage', message);
            messageInput.value = '';
        }
    }
});

// Yeni mesaj geldiğinde
socket.on('newMessage', (data) => {
    addMessageToChat(data);
});

// Önceki mesajları al
socket.on('previousMessages', (messages) => {
    chatMessages.innerHTML = '';
    messages.forEach(message => {
        addMessageToChat(message);
    });
});

// Kullanıcı katıldı bildirimi
socket.on('userJoined', (data) => {
    addSystemMessage(`${data.username} odaya katıldı`);
});

// Kullanıcı ayrıldı bildirimi
socket.on('userLeft', (data) => {
    addSystemMessage(`${data.username} odadan ayrıldı`);
});

// Mesajı sohbet alanına ekle
function addMessageToChat(data) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${data.userId === socket.id ? 'sent' : 'received'}`;
    
    const usernameSpan = document.createElement('div');
    usernameSpan.className = 'username';
    usernameSpan.textContent = data.username;
    
    const messageContent = document.createElement('div');
    messageContent.textContent = data.message;
    
    messageDiv.appendChild(usernameSpan);
    messageDiv.appendChild(messageContent);
    
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Sistem mesajı ekle
function addSystemMessage(message) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message system';
    messageDiv.textContent = message;
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// YouTube API'sini yükle
const tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
const firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

// YouTube API hazır olduğunda
window.onYouTubeIframeAPIReady = function() {
    youtubeApiReady = true;
    console.log("YouTube API hazır");
};

// Oda oluşturma
document.getElementById('createRoom').addEventListener('click', () => {
    if (!username) {
        showNotification('Lütfen önce kullanıcı adı belirleyin');
        return;
    }
    socket.emit('createRoom');
});

// Odaya katılma
document.getElementById('joinRoom').addEventListener('click', () => {
    if (!username) {
        showNotification('Lütfen önce kullanıcı adı belirleyin');
        return;
    }
    const roomId = document.getElementById('roomId').value;
    if (roomId) {
        socket.emit('joinRoom', roomId);
    } else {
        showNotification('Lütfen bir oda kodu girin');
    }
});

// Video ayarlama
document.getElementById('setVideoButton').addEventListener('click', () => {
    const url = document.getElementById('videoUrl').value;
    
    if (!url) {
        showNotification('Lütfen bir YouTube video URL\'si girin');
        return;
    }
    
    if (!currentRoom) {
        showNotification('Lütfen önce bir odaya katılın');
        return;
    }
    
    loadYouTubeVideo(url);
});

// YouTube video yükleme
function loadYouTubeVideo(url) {
    const videoId = extractYouTubeId(url);
    if (!videoId) {
        showNotification('Geçersiz YouTube URL\'si');
        return;
    }
    
    // YouTube API'nin yüklenmesini bekle
    if (!youtubeApiReady) {
        setTimeout(() => loadYouTubeVideo(url), 1000);
        return;
    }
    
    // Eğer player zaten varsa, yeni video yükle
    if (player) {
        player.loadVideoById(videoId);
        showNotification('Video yüklendi');
    } else {
        // İlk kez player oluştur
        videoPlayer.innerHTML = '<div id="youtubePlayer"></div>';
        
        player = new YT.Player('youtubePlayer', {
            height: '100%',
            width: '100%',
            videoId: videoId,
            playerVars: {
                'playsinline': 1,
                'controls': 0,
                'rel': 0
            },
            events: {
                'onReady': onPlayerReady,
                'onStateChange': onPlayerStateChange
            }
        });
    }
    
    if (currentRoom) {
        socket.emit('setVideo', {
            roomId: currentRoom,
            videoUrl: url,
            videoId: videoId
        });
    }
}

// YouTube player hazır olduğunda
function onPlayerReady(event) {
    console.log("Player hazır");
    // Oynatma kontrolleri için event listener'ları ekle
    document.getElementById('playButton').addEventListener('click', () => {
        player.playVideo();
    });
    
    document.getElementById('pauseButton').addEventListener('click', () => {
        player.pauseVideo();
    });
    
    // Zaman kaydırıcısı için event listener
    const timeSlider = document.getElementById('timeSlider');
    timeSlider.addEventListener('input', () => {
        const duration = player.getDuration();
        const seekTime = (timeSlider.value / 100) * duration;
        player.seekTo(seekTime, true);
    });
    
    // Zaman güncellemesi için interval
    setInterval(updateTimeDisplay, 1000);
}

// YouTube player durumu değiştiğinde
function onPlayerStateChange(event) {
    console.log("Player durumu değişti:", event.data);
    // YT.PlayerState: PLAYING = 1, PAUSED = 2, BUFFERING = 3, ENDED = 0
    if (event.data === YT.PlayerState.PLAYING) {
        if (currentRoom) {
            socket.emit('videoStateChange', {
                roomId: currentRoom,
                state: 'playing',
                currentTime: player.getCurrentTime()
            });
        }
    } else if (event.data === YT.PlayerState.PAUSED) {
        if (currentRoom) {
            socket.emit('videoStateChange', {
                roomId: currentRoom,
                state: 'paused',
                currentTime: player.getCurrentTime()
            });
        }
    }
}

// Zaman göstergesini güncelle
function updateTimeDisplay() {
    if (!player || !player.getCurrentTime) return;
    
    try {
        const currentTime = player.getCurrentTime() || 0;
        const duration = player.getDuration() || 0;
        
        document.getElementById('currentTime').textContent = formatTime(currentTime);
        document.getElementById('totalTime').textContent = formatTime(duration);
        
        // Kaydırıcıyı güncelle
        const timeSlider = document.getElementById('timeSlider');
        if (!timeSlider.dragging) {
            timeSlider.value = (currentTime / duration) * 100;
        }
    } catch (e) {
        console.error("Zaman güncellenirken hata:", e);
    }
}

// Zamanı biçimlendir (saniye -> MM:SS)
function formatTime(seconds) {
    seconds = Math.floor(seconds);
    const minutes = Math.floor(seconds / 60);
    seconds = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// YouTube video ID çıkarma
function extractYouTubeId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

// Socket.io olayları
socket.on('roomCreated', (roomId) => {
    currentRoom = roomId;
    document.getElementById('roomDisplay').textContent = `Oda: ${roomId}`;
    showNotification('Oda oluşturuldu');
});

socket.on('roomJoined', (roomId) => {
    currentRoom = roomId;
    document.getElementById('roomDisplay').textContent = `Oda: ${roomId}`;
    showNotification('Odaya katıldınız');
    
    // Odaya katıldıktan sonra mevcut videoyu iste
    socket.emit('getCurrentVideo', roomId);
    
    // Odada aktif ekran paylaşımı var mı kontrol et
    socket.emit('checkActiveScreenShare', roomId);
});

socket.on('currentVideo', (data) => {
    console.log("Mevcut video alındı:", data);
    if (data && data.videoUrl) {
        loadYouTubeVideo(data.videoUrl);
    }
});

socket.on('videoUpdate', (data) => {
    console.log("Video güncelleme alındı:", data);
    if (data && data.videoUrl) {
        loadYouTubeVideo(data.videoUrl);
    }
});

socket.on('videoStateUpdate', (data) => {
    if (!player || !player.playVideo || !player.pauseVideo || !player.seekTo) {
        console.log("Player henüz hazır değil");
        return;
    }
    
    console.log("Video durum güncellemesi alındı:", data);
    
    try {
        if (data.state === 'playing') {
            player.playVideo();
        } else if (data.state === 'paused') {
            player.pauseVideo();
        }
        
        if (data.state === 'seeking' || Math.abs(player.getCurrentTime() - data.currentTime) > 1) {
            player.seekTo(data.currentTime, true);
        }
    } catch (e) {
        console.error("Video durumu güncellenirken hata:", e);
    }
});

// Aktif ekran paylaşımı kontrolü için olay dinleyicisi
socket.on('activeScreenShare', (userId) => {
    showNotification('Odada aktif bir ekran paylaşımı var');
    
    // Ekran paylaşımı yapan kullanıcıya bağlantı teklifi gönder
    if (!peerConnection) {
        createPeerConnection();
        
        // Ekran paylaşımı yapan kullanıcıya özel olarak teklif gönder
        createAndSendOffer(userId);
    }
});

// Ekran paylaşımı durum değişikliği için olay dinleyicisi
socket.on('screenShareStatusChanged', (data) => {
    console.log('Ekran paylaşımı durumu değişti:', data);
    
    if (data.active) {
        showNotification('Bir kullanıcı ekran paylaşımı başlattı');
        
        // Ekran paylaşımı başlatıldıysa ve bağlantı yoksa, bağlantı kur
        if (!peerConnection) {
            createPeerConnection();
            createAndSendOffer(data.userId);
        }
    } else {
        showNotification('Ekran paylaşımı durduruldu');
        
        // Uzak videoyu kaldır ve YouTube videosunu geri yükle
        if (remoteStream) {
            const videoContainer = document.getElementById('videoContainer');
            const remoteVideos = videoContainer.querySelectorAll('video:not(.local-video)');
            remoteVideos.forEach(video => video.remove());
            
            // Eğer YouTube videosu varsa geri yükle
            if (currentRoom && rooms[currentRoom] && rooms[currentRoom].currentVideo) {
                loadYouTubeVideo(rooms[currentRoom].currentVideo.videoUrl);
            }
            
            // Bağlantıyı kapat
            if (peerConnection) {
                peerConnection.close();
                peerConnection = null;
            }
        }
    }
});

// Teklif oluştur ve gönder fonksiyonunu güncelle
async function createAndSendOffer(targetUserId) {
    try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        socket.emit('webrtcSignal', {
            type: 'offer',
            offer: peerConnection.localDescription,
            roomId: currentRoom,
            targetUserId: targetUserId // Hedef kullanıcı ID'si
        });
        
        console.log('Bağlantı teklifi gönderildi:', targetUserId);
    } catch (error) {
        console.error('Teklif oluşturulamadı:', error);
    }
}

// WebRTC sinyallerini dinle
socket.on('webrtcSignal', async (data) => {
    console.log('WebRTC sinyali alındı:', data.type, 'Kimden:', data.fromUserId);
    
    if (!peerConnection) {
        createPeerConnection();
    }
    
    switch(data.type) {
        case 'offer':
            try {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);
                
                socket.emit('webrtcSignal', {
                    type: 'answer',
                    answer: peerConnection.localDescription,
                    roomId: currentRoom,
                    targetUserId: data.fromUserId // Teklifi gönderen kullanıcıya cevap gönder
                });
                
                console.log('Bağlantı teklifine cevap gönderildi');
            } catch (error) {
                console.error('Teklif işlenemedi:', error);
            }
            break;
            
        case 'answer':
            try {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
                console.log('Bağlantı cevabı alındı ve işlendi');
            } catch (error) {
                console.error('Cevap işlenemedi:', error);
            }
            break;
            
        case 'ice-candidate':
            try {
                await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
                console.log('ICE adayı eklendi');
            } catch (error) {
                console.error('ICE adayı eklenemedi:', error);
            }
            break;
            
        case 'screenShareStarted':
            showNotification('Bir kullanıcı ekran paylaşımı başlattı');
            break;
            
        case 'screenShareStopped':
            showNotification('Ekran paylaşımı durduruldu');
            // Eğer uzak video varsa kaldır
            if (remoteStream) {
                const videoContainer = document.getElementById('videoContainer');
                const remoteVideos = videoContainer.querySelectorAll('video:not(.screen-share-video)');
                remoteVideos.forEach(video => video.remove());
                
                // Eğer YouTube videosu varsa geri yükle
                if (currentRoom && rooms[currentRoom] && rooms[currentRoom].currentVideo) {
                    loadYouTubeVideo(rooms[currentRoom].currentVideo.videoUrl);
                }
            }
            break;
    }
});

// Ekran paylaşımı butonunu ekle
function addScreenShareButton() {
    const button = document.createElement('button');
    button.id = 'screenShareButton';
    button.className = 'btn primary';
    button.innerHTML = '<i class="fas fa-desktop"></i> Ekran Paylaş';
    button.addEventListener('click', startScreenShare);
    
    document.querySelector('.video-controls').appendChild(button);
}

// Sayfa yüklendiğinde ekran paylaşımı butonunu ekle
document.addEventListener('DOMContentLoaded', () => {
    // Mevcut kodlar...
    
    // WebRTC desteğini kontrol et
    if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
        addScreenShareButton();
    } else {
        console.warn('Bu tarayıcı ekran paylaşımını desteklemiyor');
    }
});

// Ekran paylaşımı başlatma fonksiyonunu güncelleyelim
async function startScreenShare() {
    try {
        // Ekran paylaşımı için medya akışını al
        localStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true
        });
        
        // Video elementini oluştur ve akışı bağla
        const localVideo = document.createElement('video');
        localVideo.srcObject = localStream;
        localVideo.autoplay = true;
        localVideo.muted = true;
        localVideo.classList.add('screen-share-video');
        
        // Mevcut video içeriğini temizle ve ekran paylaşımını ekle
        const videoContainer = document.getElementById('videoContainer');
        videoContainer.innerHTML = '';
        videoContainer.appendChild(localVideo);
        
        // Odadaki diğer kullanıcılara sinyal gönder
        if (currentRoom) {
            socket.emit('webrtcSignal', {
                type: 'screenShareStarted',
                roomId: currentRoom,
                userId: socket.id
            });
            
            // Odada aktif ekran paylaşımı olduğunu kaydet
            socket.emit('setActiveScreenShare', {
                roomId: currentRoom,
                active: true
            });
        }
        
        // WebRTC bağlantısını başlat
        createPeerConnection();
        
        // Yerel medya akışını peer bağlantısına ekle
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
        
        // Ekran paylaşımı yapan kullanıcı, diğer kullanıcılardan gelen teklifleri dinlemek için
        // özel bir olay dinleyicisi ekler
        socket.on('webrtcSignal', async (data) => {
            if (data.type === 'offer' && localStream) {
                // Yeni bir kullanıcıdan teklif geldi, cevap ver
                try {
                    // Eğer mevcut bir bağlantı varsa, yeni bir bağlantı oluştur
                    const newPeerConnection = new RTCPeerConnection(configuration);
                    
                    // Yerel medya akışını yeni bağlantıya ekle
                    localStream.getTracks().forEach(track => {
                        newPeerConnection.addTrack(track, localStream);
                    });
                    
                    // ICE adaylarını dinle
                    newPeerConnection.onicecandidate = event => {
                        if (event.candidate) {
                            socket.emit('webrtcSignal', {
                                type: 'ice-candidate',
                                candidate: event.candidate,
                                roomId: currentRoom,
                                targetUserId: data.fromUserId
                            });
                        }
                    };
                    
                    // Uzak açıklamayı ayarla
                    await newPeerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
                    
                    // Cevap oluştur
                    const answer = await newPeerConnection.createAnswer();
                    await newPeerConnection.setLocalDescription(answer);
                    
                    // Cevabı gönder
                    socket.emit('webrtcSignal', {
                        type: 'answer',
                        answer: newPeerConnection.localDescription,
                        roomId: currentRoom,
                        targetUserId: data.fromUserId
                    });
                    
                    console.log('Yeni kullanıcıya ekran paylaşımı cevabı gönderildi');
                } catch (error) {
                    console.error('Ekran paylaşımı cevabı oluşturulamadı:', error);
                }
            }
        });
        
        // Ekran paylaşımı bittiğinde
        localStream.getVideoTracks()[0].onended = () => {
            stopScreenShare();
        };
        
    } catch (error) {
        console.error('Ekran paylaşımı başlatılamadı:', error);
        showNotification('Ekran paylaşımı başlatılamadı');
    }
}

// Ekran paylaşımını durdurma fonksiyonu ekleyelim
function stopScreenShare() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        
        // Odadaki diğer kullanıcılara bildir
        if (currentRoom) {
            socket.emit('webrtcSignal', {
                type: 'screenShareStopped',
                roomId: currentRoom
            });
            
            // Odada aktif ekran paylaşımı olmadığını kaydet
            socket.emit('setActiveScreenShare', {
                roomId: currentRoom,
                active: false
            });
        }
        
        // Peer bağlantısını kapat
        if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
        }
        
        // YouTube player'ı geri yükle
        if (rooms[currentRoom] && rooms[currentRoom].currentVideo) {
            loadYouTubeVideo(rooms[currentRoom].currentVideo.videoUrl);
        } else {
            // Video yoksa placeholder göster
            const videoContainer = document.getElementById('videoContainer');
            videoContainer.innerHTML = `
                <div class="video-placeholder">
                    <i class="fab fa-youtube"></i>
                    <p>Video yüklemek için önce bir odaya katılın ve YouTube URL'si girin</p>
                </div>
            `;
        }
        
        showNotification('Ekran paylaşımı durduruldu');
    }
}

// WebRTC peer bağlantısını oluştur
function createPeerConnection() {
    peerConnection = new RTCPeerConnection(configuration);
    
    // ICE adaylarını dinle
    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            socket.emit('webrtcSignal', {
                type: 'ice-candidate',
                candidate: event.candidate,
                roomId: currentRoom
            });
        }
    };
    
    // Uzak akışı al
    peerConnection.ontrack = event => {
        remoteStream = event.streams[0];
        const remoteVideo = document.createElement('video');
        remoteVideo.srcObject = remoteStream;
        remoteVideo.autoplay = true;
        document.getElementById('videoContainer').appendChild(remoteVideo);
    };
}

// Odaları sunucudan al
socket.on('roomInfo', (roomData) => {
    rooms[roomData.roomId] = roomData;
});

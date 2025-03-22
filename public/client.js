// Socket.io bağlantısı
const socket = io({
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
    transports: ['websocket', 'polling'],
    forceNew: false,
    // Transport hatası olursa yeniden bağlanma stratejisi
    upgrade: true
});

// Socket.io bağlantı durumunu takip et
socket.on('connect', () => {
    webRTCLog('Socket.IO bağlantısı kuruldu');
    showNotification('Sunucuya bağlanıldı');
    
    // Bağlantı yeniden kurulduğunda, eğer bir odada ise tekrar katıl
    if (currentRoom) {
        webRTCLog('Odaya yeniden katılma deneniyor:', currentRoom);
        // Doğrudan joinRoom olayını kullan
        socket.emit('joinRoom', currentRoom);
        
        // Ekran paylaşımı kontrolü
        setTimeout(() => {
            socket.emit('checkActiveScreenShare', currentRoom);
        }, 1000); // Odaya katıldıktan sonra kontrol et
    }
});

socket.on('connect_error', (error) => {
    webRTCLog('Socket.IO bağlantı hatası:', error);
    showNotification('Sunucuya bağlanılamadı: Lütfen sayfayı yenileyin');
});

socket.on('reconnect', (attemptNumber) => {
    webRTCLog('Socket.IO yeniden bağlandı, deneme:', attemptNumber);
    showNotification('Sunucu bağlantısı yeniden kuruldu');
});

socket.on('reconnect_attempt', (attemptNumber) => {
    webRTCLog('Socket.IO yeniden bağlanmaya çalışıyor, deneme:', attemptNumber);
    // Polling daha güvenilir bir transport metodu olabilir
    socket.io.opts.transports = ['polling', 'websocket'];
});

socket.on('reconnect_error', (error) => {
    webRTCLog('Socket.IO yeniden bağlantı hatası:', error);
    showNotification('Sunucu bağlantısı yeniden kurulamadı');
});

socket.on('reconnect_failed', () => {
    webRTCLog('Socket.IO yeniden bağlantı başarısız oldu');
    showNotification('Sunucu bağlantısı yeniden kurulamadı: Sayfayı yenileyin');
});

socket.on('disconnect', (reason) => {
    webRTCLog('Socket.IO bağlantısı kesildi:', reason);
    showNotification('Sunucu bağlantısı kesildi: Otomatik yeniden bağlanıyor...');
    
    // Transport kapandığında client yeniden bağlanmayabilir
    if (reason === 'transport close' || reason === 'transport error') {
        webRTCLog('Transport hatası, manuel yeniden bağlanma denenecek');
        
        // 3 saniye sonra manuel olarak yeniden bağlanmayı dene
        setTimeout(() => {
            if (!socket.connected) {
                webRTCLog('Manuel yeniden bağlanma deneniyor...');
                socket.connect();
            }
        }, 3000);
    }
});

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
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        // NAT arkasındaki cihazlar için TURN sunucuları ekliyoruz
        // Farklı ağlardaki kullanıcılar için TURN şarttır
        {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        {
            urls: 'turn:openrelay.metered.ca:443',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        // Yedek TURN sunucuları
        {
            urls: 'turn:openrelay.metered.ca:443?transport=tcp',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        {
            urls: 'turn:relay.metered.ca:80',
            username: 'e8c7e3c6176cee715f06adc3',
            credential: 'mZfCS1KYAV2z7X+j'
        },
        {
            urls: 'turn:relay.metered.ca:443',
            username: 'e8c7e3c6176cee715f06adc3',
            credential: 'mZfCS1KYAV2z7X+j'
        },
    ],
    iceCandidatePoolSize: 10,
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
    // Farklı ağlardaki kullanıcılar için TURN kullanımını zorunlu kılabiliriz
    // Test amaçlı olarak TURN'a zorla
    iceTransportPolicy: 'relay' // 'all' yerine 'relay' kullanarak sadece TURN sunucuları kullanmaya zorla
};

// WebRTC debug modu
const webRTCDebug = true;

// WebRTC debug log
function webRTCLog(...args) {
    if (webRTCDebug) {
        console.log('[WebRTC]', ...args);
    }
}

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
    webRTCLog('Aktif ekran paylaşımı bildirimi alındı, kullanıcı:', userId);
    showNotification('Ekran paylaşımı başlatıldı, bağlanılıyor...');
    
    // Kullanıcıya görsel geri bildirim
    const videoContainer = document.getElementById('videoContainer');
    videoContainer.innerHTML = `
        <div class="loading-screen">
            <div class="spinner"></div>
            <p>Ekran paylaşımına bağlanılıyor...</p>
        </div>
    `;
    
    // YouTube player'ı kaldır (eğer varsa)
    if (player) {
        try {
            player.destroy();
            player = null;
        } catch (e) {
            webRTCLog('YouTube player kapatılırken hata:', e);
        }
    }
    
    // Ekran paylaşımı yapan kullanıcıya bağlantı teklifi gönder
    if (!peerConnection) {
        webRTCLog('Ekran paylaşımı için bağlantı oluşturuluyor');
        createPeerConnection();
        
        // Ekran paylaşımı yapan kullanıcıya özel olarak teklif gönderiliyor
        webRTCLog('Ekran paylaşımı yapan kullanıcıya teklif gönderiliyor');
        setTimeout(() => {
        createAndSendOffer(userId);
        }, 1000); // Bağlantının kurulması için kısa bir gecikme ekle
    }
});

// Ekran paylaşımı durum değişikliği için olay dinleyicisi
socket.on('screenShareStatusChanged', (data) => {
    webRTCLog('Ekran paylaşımı durumu değişti:', data);
    
    if (data.active) {
        showNotification('Ekran paylaşımına bağlanılıyor...');
        
        // Kullanıcıya görsel geri bildirim
        const videoContainer = document.getElementById('videoContainer');
        videoContainer.innerHTML = `
            <div class="loading-screen">
                <div class="spinner"></div>
                <p>Ekran paylaşımına bağlanılıyor...</p>
            </div>
        `;
        
        // YouTube player'ı kaldır (eğer varsa)
        if (player) {
            try {
                player.destroy();
                player = null;
            } catch (e) {
                webRTCLog('YouTube player kapatılırken hata:', e);
            }
        }
        
        // Ekran paylaşımı başlatıldıysa ve bağlantı yoksa, bağlantı kur
        if (!peerConnection) {
            webRTCLog('Yeni ekran paylaşımı için bağlantı oluşturuluyor');
            createPeerConnection();
            webRTCLog('Ekran paylaşımı yapan kullanıcıya teklif gönderiliyor');
            setTimeout(() => {
                createAndSendOffer(data.userId);
            }, 1000); // Bağlantının kurulması için kısa bir gecikme ekle
        }
    } else {
        showNotification('Ekran paylaşımı durduruldu');
        
        // Video elementleri ve bağlantıları temizle
        cleanupScreenShare();
        
        // Eğer YouTube videosu varsa geri yükle
        if (currentRoom && rooms[currentRoom] && rooms[currentRoom].currentVideo) {
            webRTCLog('YouTube videosu geri yükleniyor');
            loadYouTubeVideo(rooms[currentRoom].currentVideo.videoUrl);
        } else {
            // Video yoksa placeholder göster
            webRTCLog('Video placeholder gösteriliyor');
            const videoContainer = document.getElementById('videoContainer');
            videoContainer.innerHTML = `
                <div class="video-placeholder">
                    <i class="fab fa-youtube"></i>
                    <p>Video yüklemek için önce bir odaya katılın ve YouTube URL'si girin</p>
                </div>
            `;
        }
    }
});

// WebRTC sinyal işleyicisi - ekran paylaşımı yapan veya izleyen kullanıcılar için
socket.on('webrtcSignal', async (data) => {
    webRTCLog('WebRTC sinyali alındı:', data.type, 'Kimden:', data.fromUserId);
    
    // Debug: Socket ID ve bağlantı durumunu kontrol et
    webRTCLog('Mevcut socket ID:', socket.id);
    webRTCLog('Bağlantı durumu:', socket.connected ? 'Bağlı' : 'Bağlı değil');
    
    // Ekran paylaşımcı, gelen bir offer'a yeni bir bağlantı ile cevap verir
    if (data.type === 'offer' && localStream) {
        webRTCLog('Yeni kullanıcıdan teklif alındı ve ekran paylaşımı aktif:', data.fromUserId);
        handleIncomingOfferWhileSharing(data);
        return;
    }
    
    // Teklif isteği aldığında otomatik olarak teklif oluştur ve gönder
    if (data.type === 'offerRequest' && !localStream) {
        webRTCLog('Ekran paylaşan kullanıcıdan teklif isteği alındı:', data.fromUserId);
        // Peer bağlantısı oluştur ve teklif gönder
        if (!peerConnection) {
            createPeerConnection();
        }
        
        // Teklif oluştur ve gönder
        try {
            webRTCLog('Ekran paylaşımı için teklif oluşturuluyor');
            const offer = await peerConnection.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true
            });
        await peerConnection.setLocalDescription(offer);
        
            webRTCLog('Teklif gönderiliyor');
        socket.emit('webrtcSignal', {
            type: 'offer',
            offer: peerConnection.localDescription,
            roomId: currentRoom,
                targetUserId: data.fromUserId
            });
        } catch (e) {
            webRTCLog('Teklif oluşturma hatası:', e);
        }
        return;
    }
    
    // Sinyal işleyici için normal akış
    if (!peerConnection) {
        webRTCLog('Peer bağlantısı oluşturuluyor (sinyal alındığında)');
        createPeerConnection();
    }
    
    switch(data.type) {
        case 'offer':
            try {
                webRTCLog('Teklif alındı, işleniyor...');
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
                webRTCLog('Uzak açıklama ayarlandı, cevap oluşturuluyor...');
                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);
                
                webRTCLog('Teklif cevabı gönderiliyor. Hedef:', data.fromUserId);
                socket.emit('webrtcSignal', {
                    type: 'answer',
                    answer: peerConnection.localDescription,
                    roomId: currentRoom,
                    targetUserId: data.fromUserId 
                });
                
                webRTCLog('Bağlantı teklifine cevap gönderildi');
            } catch (error) {
                webRTCLog('Teklif işlenemedi:', error);
                showNotification('Bağlantı hatası: ' + error.message);
            }
            break;
            
        case 'answer':
            try {
                webRTCLog('Cevap alındı, işleniyor...');
                if (peerConnection && peerConnection.signalingState !== 'closed') {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
                    webRTCLog('Bağlantı cevabı alındı ve işlendi');
                } else {
                    webRTCLog('Cevap işlenemedi: Peer bağlantısı kapalı veya yok');
                }
            } catch (error) {
                webRTCLog('Cevap işlenemedi:', error);
                showNotification('Bağlantı hatası: ' + error.message);
            }
            break;
            
        case 'ice-candidate':
            try {
                webRTCLog('ICE adayı alındı');
                
                if (!peerConnection) {
                    webRTCLog('Peer bağlantısı bulunmuyor, yeni bağlantı oluşturuluyor');
                    createPeerConnection();
                }
                
                if (peerConnection.remoteDescription && peerConnection.remoteDescription.type) {
                    webRTCLog('ICE adayı ekleniyor:', data.candidate);
                await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
                    webRTCLog('ICE adayı eklendi');
                } else {
                    webRTCLog('ICE adayı şu anda eklenemiyor - bağlantı henüz hazır değil');
                    // Daha sonra eklemek üzere ICE adaylarını saklayacak bir dizi oluştur
                    if (!window.pendingIceCandidates) {
                        window.pendingIceCandidates = [];
                    }
                    window.pendingIceCandidates.push(data.candidate);
                    webRTCLog('ICE adayı bekleme listesine eklendi, bekleyen adaylar:', window.pendingIceCandidates.length);
                }
            } catch (error) {
                webRTCLog('ICE adayı eklenemedi:', error);
                showNotification('Bağlantı hatası: ' + error.message);
            }
            break;
            
        case 'screenShareStarted':
            webRTCLog('Ekran paylaşımı başlatıldı sinyali alındı');
            showNotification('Bir kullanıcı ekran paylaşımı başlattı');
            break;
            
        case 'screenShareStopped':
            webRTCLog('Ekran paylaşımı durduruldu sinyali alındı');
            showNotification('Ekran paylaşımı durduruldu');
            
            // Eğer uzak video varsa kaldır
            if (remoteStream) {
                webRTCLog('Uzak video akışı temizleniyor');
                cleanupScreenShare();
                
                // Eğer YouTube videosu varsa geri yükle
                if (currentRoom && rooms[currentRoom] && rooms[currentRoom].currentVideo) {
                    webRTCLog('YouTube videosu geri yükleniyor');
                    loadYouTubeVideo(rooms[currentRoom].currentVideo.videoUrl);
                }
            }
            break;
    }
});

// Ekran paylaşımı durumu değişikliği onay mesajı
socket.on('activeScreenShareSet', (data) => {
    webRTCLog('Ekran paylaşımı durumu onayı alındı:', data);
    
    if (data.success) {
        if (data.active) {
            webRTCLog('Ekran paylaşımı başarıyla aktifleştirildi');
            // localStream ve diğer ayarlar zaten yapıldı, burada ek işlemler yapılabilir
        } else {
            webRTCLog('Ekran paylaşımı başarıyla durduruldu');
        }
    } else {
        webRTCLog('Ekran paylaşımı durumu değiştirilemedi:', data.error);
        showNotification('Ekran paylaşımı ayarlanamadı: ' + data.error);
        
        // Başarısız olursa temizlik yap
        if (localStream) {
            webRTCLog('Yerel akış temizleniyor');
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
        }
    }
});

// Ekran paylaşımı yapan kullanıcı için gelen teklifleri işle
async function handleIncomingOfferWhileSharing(data) {
    try {
        webRTCLog('Ekran paylaşımı yaparken gelen teklif işleniyor...');
        
        // Her yeni kullanıcı için yeni bir bağlantı oluştur
        const newPeerConnection = new RTCPeerConnection(configuration);
        
        // ICE adaylarını dinle
        newPeerConnection.onicecandidate = event => {
            if (event.candidate) {
                webRTCLog('ICE adayı gönderiliyor (yeni bağlantı):', event.candidate);
                socket.emit('webrtcSignal', {
                    type: 'ice-candidate',
                    candidate: event.candidate,
                    roomId: currentRoom,
                    targetUserId: data.fromUserId
                });
            }
        };
        
        // ICE durum değişikliklerini izle
        newPeerConnection.oniceconnectionstatechange = () => {
            webRTCLog('ICE bağlantı durumu değişti (yeni bağlantı):', newPeerConnection.iceConnectionState);
        };
        
        // Yerel medya akışını yeni bağlantıya ekle
        if (localStream) {
            localStream.getTracks().forEach(track => {
                try {
                    newPeerConnection.addTrack(track, localStream);
                    webRTCLog('Track eklendi (yeni bağlantı):', track.kind);
                } catch (e) {
                    webRTCLog('Track eklenirken hata (yeni bağlantı):', e);
                }
            });
        } else {
            webRTCLog('Lokalstream bulunamadı!');
            return;
        }
        
        // Uzak açıklamayı ayarla
        webRTCLog('Uzak açıklama ayarlanıyor (yeni bağlantı)...');
        await newPeerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        
        // Cevap oluştur
        webRTCLog('Cevap oluşturuluyor (yeni bağlantı)...');
        const answer = await newPeerConnection.createAnswer();
        await newPeerConnection.setLocalDescription(answer);
        
        // Cevabı gönder
        webRTCLog('Cevap gönderiliyor (yeni bağlantı)...');
        socket.emit('webrtcSignal', {
            type: 'answer',
            answer: newPeerConnection.localDescription,
            roomId: currentRoom,
            targetUserId: data.fromUserId
        });
        
        webRTCLog('Yeni kullanıcıya ekran paylaşımı cevabı gönderildi');
    } catch (error) {
        webRTCLog('Ekran paylaşımı cevabı oluşturulamadı:', error);
        showNotification('Bağlantı hatası: ' + error.message);
    }
}

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
        webRTCLog('Ekran paylaşımı başlatılıyor...');
        
        // Bağlantı zaten varsa temizle
        if (localStream) {
            webRTCLog('Var olan ekran paylaşımı temizleniyor...');
            stopScreenShare();
        }
        
        if (peerConnection) {
            webRTCLog('Var olan peer bağlantısı kapatılıyor...');
            peerConnection.close();
            peerConnection = null;
        }
        
        // Ekran paylaşımı için medya akışını al
        const mediaConstraints = {
            video: {
                cursor: 'always',
                displaySurface: 'monitor',
                // Video kalitesini belirle - çok yüksek değerler performans sorunlarına neden olabilir
                width: { ideal: 1280, max: 1920 },
                height: { ideal: 720, max: 1080 },
                frameRate: { ideal: 25, max: 30 }
            }
        };
        
        // Önce sadece video ile deneyelim, ses isteğe bağlı eklenecek
        webRTCLog('Ekran paylaşımı medya akışı isteniyor (önce video)...');
        try {
            localStream = await navigator.mediaDevices.getDisplayMedia(mediaConstraints);
            webRTCLog('Ekran paylaşımı akışı alındı (video)');
            
            // Ses eklemek isteyip istemediğini sor
            const addAudio = confirm('Ekran paylaşımına ses de eklemek istiyor musunuz?');
            
            if (addAudio) {
                try {
                    // Ses için ayrı bir akış al ve ekran paylaşımına ekle
                    webRTCLog('Ses akışı isteniyor...');
                    const audioStream = await navigator.mediaDevices.getUserMedia({
                        audio: {
                            echoCancellation: true,
                            noiseSuppression: true,
                            autoGainControl: true
                        }
                    });
                    
                    // Ses izlerini ekran paylaşımına ekle
                    const audioTrack = audioStream.getAudioTracks()[0];
                    if (audioTrack) {
                        webRTCLog('Ses izi ekleniyor:', audioTrack.label);
                        localStream.addTrack(audioTrack);
                    }
                } catch (audioErr) {
                    webRTCLog('Ses akışı alınamadı:', audioErr);
                    showNotification('Ses eklenemedi, sadece video paylaşılacak');
                }
            }
        } catch (err) {
            webRTCLog('Ekran paylaşımı akışı alınamadı:', err);
            showNotification('Ekran paylaşımı başlatılamadı: ' + err.message);
            return false;
        }
        
        // Akış içeriğini kontrol et
        webRTCLog('Medya akışı alındı:', localStream.id);
        webRTCLog('Video izleri:', localStream.getVideoTracks().length, 
                  'Aktif:', localStream.getVideoTracks()[0]?.enabled || false);
        webRTCLog('Ses izleri:', localStream.getAudioTracks().length,
                  'Aktif:', localStream.getAudioTracks()[0]?.enabled || false);
        
        // Hiç video izi yoksa hata ver
        if (localStream.getVideoTracks().length === 0) {
            webRTCLog('Hata: Video izleri bulunamadı');
            showNotification('Ekran paylaşımı başlatılamadı: Video izleri bulunamadı');
            return false;
        }
        
        // Video elementi oluştur ve akışı bağla
        const videoContainer = document.getElementById('videoContainer');
        videoContainer.innerHTML = ''; // İçeriği temizle
        
        const localVideo = document.createElement('video');
        localVideo.autoplay = true;
        localVideo.muted = true; // Yerel sesi sustur, yankıyı önler
        localVideo.playsInline = true;
        localVideo.controls = true;
        localVideo.classList.add('screen-share-video');
        
        // Önce DOM'a ekle, sonra srcObject ayarla
        videoContainer.appendChild(localVideo);
        
        try {
            localVideo.srcObject = localStream;
            webRTCLog('Yerel video elementine srcObject atandı');
        } catch (e) {
            webRTCLog('srcObject atama hatası:', e);
            // Alternatif yöntem dene
            try {
                localVideo.src = URL.createObjectURL(localStream);
                webRTCLog('Yerel video elementine src atandı (createObjectURL ile)');
            } catch (urlErr) {
                webRTCLog('URL.createObjectURL hatası:', urlErr);
                showNotification('Video gösterimi başlatılamadı');
                return false;
            }
        }
        
        // Ekran paylaşımı bittiğinde dinle
        localStream.getVideoTracks()[0].onended = () => {
            webRTCLog('Ekran paylaşımı kullanıcı tarafından sonlandırıldı');
            stopScreenShare();
        };
        
        // WebRTC bağlantısını oluştur ve akışı ekle
        webRTCLog('WebRTC bağlantısı oluşturuluyor');
        if (!createPeerConnection()) {
            webRTCLog('Peer bağlantısı oluşturulamadı');
            throw new Error('Peer bağlantısı oluşturulamadı');
        }
        
        // Yerel medya akışını peer bağlantısına ekle
        webRTCLog('Yerel medya akışı peer bağlantısına ekleniyor...');
        localStream.getTracks().forEach(track => {
            try {
                const sender = peerConnection.addTrack(track, localStream);
                webRTCLog('İz eklendi:', track.kind, track.label, 'Aktif:', track.enabled);
            } catch (e) {
                webRTCLog('İz eklenirken hata:', e);
                showNotification('İz eklenirken hata oluştu: ' + e.message);
            }
        });
        
        // Odadaki diğer kullanıcılara sinyal gönder
        if (currentRoom) {
            webRTCLog('Ekran paylaşımı sinyali gönderiliyor...');
            socket.emit('webrtcSignal', {
                type: 'screenShareStarted',
                roomId: currentRoom,
                userId: socket.id
            });
            
            // Odada aktif ekran paylaşımı olduğunu kaydet
            webRTCLog('Aktif ekran paylaşımı durumu sunucuya bildiriliyor');
            socket.emit('setActiveScreenShare', {
                roomId: currentRoom,
                active: true
            });
            
            showNotification('Ekran paylaşımı başlatıldı');
            
            // Her kullanıcıya teklif gönderildiğinden emin olmak için,
            // odadaki tüm kullanıcılara offer göndermek için bir tetikleyici gönder
            setTimeout(() => {
                webRTCLog('Teklif oluşturma tetikleyicisi gönderiliyor');
                            socket.emit('webrtcSignal', {
                    type: 'requestOffer',
                    roomId: currentRoom
                });
            }, 1000);
        } else {
            showNotification('Ekran paylaşımı başlatıldı, ancak oda bulunamadı');
        }
        
        return true;
                } catch (error) {
        webRTCLog('Ekran paylaşımı başlatılamadı:', error);
        showNotification('Ekran paylaşımı başlatılamadı: ' + error.message);
        return false;
    }
}

// Ekran paylaşımını durdurma fonksiyonu ekleyelim
function stopScreenShare() {
    webRTCLog('Ekran paylaşımı durduruluyor...');
    if (localStream) {
        try {
            // Tüm medya izlerini durdur
            webRTCLog('Medya izleri durduruluyor');
            localStream.getTracks().forEach(track => {
                track.stop();
                webRTCLog(`${track.kind} izi durduruldu`);
            });
        
        // Odadaki diğer kullanıcılara bildir
        if (currentRoom) {
                webRTCLog('Ekran paylaşımı durdurma sinyali gönderiliyor');
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
                webRTCLog('Peer bağlantısı kapatılıyor');
                try {
                    // Önce tüm aktif izleri kaldır
                    const senders = peerConnection.getSenders();
                    senders.forEach(sender => {
                        try {
                            peerConnection.removeTrack(sender);
                            webRTCLog('İz gönderici kaldırıldı');
                        } catch (e) {
                            webRTCLog('İz gönderici kaldırılırken hata:', e);
                        }
                    });
                    
                    // Bağlantıyı kapat
            peerConnection.close();
                    webRTCLog('Peer bağlantısı başarıyla kapatıldı');
                } catch (e) {
                    webRTCLog('Peer bağlantısı kapatılırken hata:', e);
                }
            peerConnection = null;
        }
            
            // Lokal akışı temizle
            localStream = null;
        
        // YouTube player'ı geri yükle
            try {
                if (currentRoom && rooms[currentRoom] && rooms[currentRoom].currentVideo) {
                    webRTCLog('YouTube videosu yükleniyor:', rooms[currentRoom].currentVideo.videoUrl);
            loadYouTubeVideo(rooms[currentRoom].currentVideo.videoUrl);
        } else {
            // Video yoksa placeholder göster
                    webRTCLog('Video placeholder gösteriliyor');
            const videoContainer = document.getElementById('videoContainer');
            videoContainer.innerHTML = `
                <div class="video-placeholder">
                    <i class="fab fa-youtube"></i>
                    <p>Video yüklemek için önce bir odaya katılın ve YouTube URL'si girin</p>
                        </div>
                    `;
                }
            } catch (e) {
                webRTCLog('Video gösterimi sırasında hata:', e);
                // En azından bir şeyler göster
                const videoContainer = document.getElementById('videoContainer');
                videoContainer.innerHTML = `
                    <div class="video-placeholder">
                        <p>Video oynatıcı yüklenemedi. Sayfayı yenilemeyi deneyin.</p>
                </div>
            `;
        }
        
        showNotification('Ekran paylaşımı durduruldu');
            return true;
        } catch (error) {
            webRTCLog('Ekran paylaşımı durdurulurken hata:', error);
            showNotification('Ekran paylaşımı durdurulurken hata oluştu');
            return false;
        }
    } else {
        webRTCLog('Durduruacak aktif ekran paylaşımı bulunamadı');
        return false;
    }
}

// WebRTC peer bağlantısını oluştur
function createPeerConnection() {
    try {
        webRTCLog('Peer bağlantısı oluşturuluyor...');
        
        // Eğer zaten bir bağlantı varsa, kapatıp yeniden oluştur
        if (peerConnection) {
            webRTCLog('Var olan peer bağlantısı kapatılıyor...');
            peerConnection.close();
            peerConnection = null;
        }
        
    peerConnection = new RTCPeerConnection(configuration);
    
    // ICE adaylarını dinle
    peerConnection.onicecandidate = event => {
        if (event.candidate) {
                webRTCLog('ICE adayı bulundu:', event.candidate);
                
                // NAT traversal tanısı için ICE aday türü ve ilgili sunucuyu logla
                if (event.candidate.type) {
                    webRTCLog('ICE adayı türü:', event.candidate.type);
                }
                if (event.candidate.relatedAddress) {
                    webRTCLog('ICE adayı ilişkili adres:', event.candidate.relatedAddress);
                }
                
            socket.emit('webrtcSignal', {
                type: 'ice-candidate',
                candidate: event.candidate,
                roomId: currentRoom
            });
            } else {
                webRTCLog('ICE toplama tamamlandı - tüm adaylar gönderildi');
            }
        };
        
        // ICE bağlantı durumunu belirli aralıklarla kontrol et
        let iceCheckInterval;
        function startIceStateMonitoring() {
            if (iceCheckInterval) {
                clearInterval(iceCheckInterval);
            }
            
            // Her 2 saniyede bir ICE bağlantı durumunu kontrol et
            iceCheckInterval = setInterval(() => {
                if (!peerConnection) {
                    clearInterval(iceCheckInterval);
                    return;
                }
                
                webRTCLog('ICE bağlantı durumu (düzenli kontrol):', peerConnection.iceConnectionState);
                
                // ICE bağlantısı 30 saniye içinde kurulmazsa sorun var demektir
                if (peerConnection.iceConnectionState === 'checking' && 
                    Date.now() - peerConnection._creationTime > 30000) {
                    webRTCLog('ICE bağlantısı uzun süredir kurulamıyor, TURN sunucuları erişimi kontrol ediliyor...');
                    showNotification('Bağlantı kurulamıyor. NAT/Güvenlik Duvarı sorunları olabilir.');
                }
                
                // Bağlantı koparsa temizle
                if (peerConnection.iceConnectionState === 'disconnected' || 
                    peerConnection.iceConnectionState === 'failed' || 
                    peerConnection.iceConnectionState === 'closed') {
                    clearInterval(iceCheckInterval);
                }
            }, 2000);
        }
        
        // Bağlantı oluşturulma zamanını kaydet
        peerConnection._creationTime = Date.now();
        startIceStateMonitoring();
        
        // ICE toplama durumunu izle
        peerConnection.onicegatheringstatechange = () => {
            webRTCLog('ICE toplama durumu:', peerConnection.iceGatheringState);
            
            // ICE aday toplama işlemi bittiğinde
            if (peerConnection.iceGatheringState === 'complete') {
                webRTCLog('ICE aday toplama tamamlandı. Toplanan aday sayısı kontrol ediliyor...');
                
                // Oluşturulan aday sayısını veya türünü kontrol et
                const senders = peerConnection.getSenders();
                if (senders.length > 0) {
                    webRTCLog('Aktif gönderici sayısı:', senders.length);
                }
            }
        };
        
        // ICE connection durumunu izle
        peerConnection.oniceconnectionstatechange = () => {
            webRTCLog('ICE bağlantı durumu değişti:', peerConnection.iceConnectionState);
            
            // Tarayıcıya göre bildirim içeriği değiştirilebilir
            const isFirefox = navigator.userAgent.indexOf('Firefox') !== -1;
            
            if (peerConnection.iceConnectionState === 'connected' || 
                peerConnection.iceConnectionState === 'completed') {
                webRTCLog('ICE bağlantısı başarılı!');
                showNotification('Bağlantı kuruldu');
                
                // Bağlantı başarılı olduğunda seçilen ICE yolunu logla
                if (peerConnection.getSelectedCandidatePair) {
                    try {
                        const pair = peerConnection.getSelectedCandidatePair();
                        webRTCLog('Seçilen ICE aday çifti:', pair);
                    } catch (e) {
                        webRTCLog('Seçilen ICE aday çifti alınamadı:', e);
                    }
                }
            }
            else if (peerConnection.iceConnectionState === 'failed' || 
                peerConnection.iceConnectionState === 'disconnected' || 
                peerConnection.iceConnectionState === 'closed') {
                webRTCLog('ICE bağlantısı başarısız oldu veya kapandı');
                
                // Firefox ve Chrome'da farklı mesajlar göster
                if (isFirefox) {
                    showNotification('Bağlantı kurulamadı. Lütfen Firefox ayarlarınızı kontrol edin.');
                } else {
                    showNotification('Bağlantı kesildi. NAT/Güvenlik Duvarı sorunları olabilir.');
                }
                
                // Bağlantıyı yeniden kurmayı dene
                if (localStream) {
                    webRTCLog('Bağlantıyı yeniden kurma deneniyor...');
                    // 5 saniye içinde tekrar deneme yapmadan önce temizleme yap
                    setTimeout(() => {
                        createPeerConnection();
                        localStream.getTracks().forEach(track => {
                            peerConnection.addTrack(track, localStream);
                        });
                        
                        // Odadaki diğer kullanıcılara yeniden teklif gönder
                        if (currentRoom) {
                            webRTCLog('Yeniden teklif gönderme tetikleyicisi gönderiliyor...');
                            socket.emit('webrtcSignal', {
                                type: 'requestOffer',
                                roomId: currentRoom
                            });
                        }
                    }, 5000);
                } else if (currentRoom) {
                    // Ekran paylaşımını izleyen taraf için yeniden bağlanma
                    webRTCLog('İzleyici olarak bağlantıyı yeniden kurma deneniyor...');
                    setTimeout(() => {
                        // Yeniden dene butonunu göster
                        showRetryButton();
                    }, 3000);
                }
            }
        };
        
        // Bağlantı durumunu izle
        peerConnection.onconnectionstatechange = () => {
            webRTCLog('Bağlantı durumu değişti:', peerConnection.connectionState);
            
            // Bağlantı durumunu kontrol et ve yönet
            if (peerConnection.connectionState === 'connected') {
                webRTCLog('Bağlantı başarıyla kuruldu!');
                showNotification('Ekran paylaşımı bağlantısı başarıyla kuruldu');
                
                // Bekleyen ICE adaylarını işle
                processPendingIceCandidates();
            } else if (peerConnection.connectionState === 'failed' || 
                       peerConnection.connectionState === 'disconnected' || 
                       peerConnection.connectionState === 'closed') {
                webRTCLog('Bağlantı başarısız oldu veya kapandı');
                showNotification('Bağlantı hatası. Yeniden bağlanılıyor...');
                
                // Bağlantı başarısız olduğunda ne yapılacak
                if (!localStream) {
                    // 5 saniye sonra yeniden bağlanmayı dene
                    setTimeout(() => {
                        if (currentRoom) {
                            socket.emit('checkActiveScreenShare', currentRoom);
                        }
                    }, 5000);
                }
            }
        };
        
        // Sinyal durumunu izle
        peerConnection.onsignalingstatechange = () => {
            webRTCLog('Sinyal durumu değişti:', peerConnection.signalingState);
            
            // Sinyal durumu tamamlandığında bekleyen ICE adaylarını işle
            if (peerConnection.signalingState === 'stable') {
                webRTCLog('Sinyal durumu kararlı, bekleyen ICE adayları işlenebilir');
                processPendingIceCandidates();
            }
        };
        
        // Bağlantı hatalarını izle
        peerConnection.onerror = (error) => {
            webRTCLog('Peer bağlantı hatası:', error);
            showNotification('Bağlantı hatası oluştu');
        };
    
    // Uzak akışı al
    peerConnection.ontrack = event => {
            webRTCLog('Uzak medya akışı alındı:', event.streams[0]);
            
            // Akış yoksa hata ver ve çık
            if (!event.streams || !event.streams[0]) {
                webRTCLog('Hata: Uzak medya akışı alınamadı veya boş');
                showNotification('Ekran paylaşımı akışı alınamadı');
                return;
            }
            
            // Akış detaylarını logla ve mevcut remoteStream'i güncelle
        remoteStream = event.streams[0];
            webRTCLog('Akış ID:', remoteStream.id);
            webRTCLog('Video izleri:', remoteStream.getVideoTracks().length);
            webRTCLog('Ses izleri:', remoteStream.getAudioTracks().length);
            
            // Kullanıcıya bildirim göster
            showNotification('Ekran paylaşımı alınıyor, video oluşturuluyor...');
            
            // Video elementini oluşturmadan önce akışın hazır olduğundan emin olalım
            const videoTrack = remoteStream.getVideoTracks()[0];
            if (videoTrack) {
                webRTCLog('Video izi bulundu:', videoTrack.label, 'Aktif mi:', videoTrack.enabled);
                
                // Bazı tarayıcıların ek süreye ihtiyacı var - çok kısa bir gecikme ekleyelim
                setTimeout(() => {
                    createRemoteVideoElement(remoteStream);
                }, 200);
            } else {
                webRTCLog('Hata: Video izi bulunamadı');
                showNotification('Ekran paylaşımı video izi bulunamadı');
                showRetryButton();
            }
        };
        
        webRTCLog('Peer bağlantısı başarıyla oluşturuldu');
        return true;
    } catch (error) {
        webRTCLog('Peer bağlantısı oluşturulurken hata:', error);
        showNotification('Bağlantı kurulamadı: ' + error.message);
        return false;
    }
}

// Bekleyen ICE adaylarını işleme fonksiyonu
function processPendingIceCandidates() {
    if (!pendingIceCandidates.length) {
        return;
    }
    
    webRTCLog(`İşlenmeyi bekleyen ${pendingIceCandidates.length} adet ICE adayı var`);
    
    if (!peerConnection || peerConnection.signalingState === 'closed') {
        webRTCLog('Peer bağlantısı kapalı, bekleyen ICE adayları işlenemedi');
        pendingIceCandidates = []; // Adayları temizle
        return;
    }
    
    // RemoteDescription yoksa işleme yapma
    if (!peerConnection.remoteDescription) {
        webRTCLog('RemoteDescription yok, bekleyen ICE adayları işlenemedi');
        return;
    }
    
    while (pendingIceCandidates.length > 0) {
        const candidate = pendingIceCandidates.shift();
        try {
            webRTCLog('Bekleyen ICE adayı ekleniyor:', candidate);
            peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
                .then(() => {
                    webRTCLog('Bekleyen ICE adayı başarıyla eklendi');
                })
                .catch(error => {
                    webRTCLog('Bekleyen ICE adayı eklenirken hata:', error);
                });
        } catch (e) {
            webRTCLog('Bekleyen ICE adayı işlenirken hata:', e);
        }
    }
}

// Teklif oluştur ve gönder fonksiyonunu güncelle
async function createAndSendOffer(targetUserId) {
    try {
        webRTCLog('Bağlantı teklifi oluşturuluyor...');
        
        // Peer bağlantısı yoksa oluştur
        if (!peerConnection) {
            webRTCLog('Peer bağlantısı oluşturuluyor (teklif göndermeden önce)');
            createPeerConnection();
            
            // Yerel medya akışı varsa ekle
            if (localStream) {
                webRTCLog('Yerel medya akışı ekleniyor');
                localStream.getTracks().forEach(track => {
                    try {
                        peerConnection.addTrack(track, localStream);
                        webRTCLog('İz eklendi:', track.kind);
                    } catch (e) {
                        webRTCLog('İz eklenirken hata:', e);
                    }
                });
            }
        }
        
        // Teklif oluştur
        const offer = await peerConnection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true
        });
        
        webRTCLog('Teklif oluşturuldu, yerel açıklama ayarlanıyor...');
        await peerConnection.setLocalDescription(offer);
        
        webRTCLog('Teklif gönderiliyor, hedef kullanıcı:', targetUserId);
        socket.emit('webrtcSignal', {
            type: 'offer',
            offer: peerConnection.localDescription,
            roomId: currentRoom,
            targetUserId: targetUserId 
        });
        
        webRTCLog('Bağlantı teklifi gönderildi:', targetUserId);
    } catch (error) {
        webRTCLog('Teklif oluşturulamadı:', error);
        showNotification('Bağlantı hatası: ' + error.message);
    }
}

// Uzak video elementini oluştur ve görüntüle
function createRemoteVideoElement(stream) {
    try {
        webRTCLog('Uzak video elementi oluşturuluyor...');
        const videoContainer = document.getElementById('videoContainer');
        if (!videoContainer) {
            webRTCLog('Hata: Video container elementi bulunamadı');
            showNotification('Video gösterilemiyor: Container elementi bulunamadı');
            return;
        }
        
        // Önce yükleniyor ekranı göster
        videoContainer.innerHTML = `
            <div class="loading-screen">
                <div class="spinner"></div>
                <p>Ekran paylaşımı yükleniyor...</p>
            </div>
        `;
        
        // Önce akışın durumunu kontrol et
        const videoTracks = stream.getVideoTracks();
        if (!videoTracks || videoTracks.length === 0) {
            webRTCLog('Hata: Video izleri bulunamadı');
            showNotification('Video izleri bulunamadı, yeniden bağlanılıyor...');
            
            setTimeout(() => {
                if (currentRoom) {
                    socket.emit('checkActiveScreenShare', currentRoom);
                }
            }, 2000);
            return;
        }
        
        // Video izinin durumunu kontrol et
        const videoTrack = videoTracks[0];
        webRTCLog('Video izi durumu:', videoTrack.readyState, 'Etkin:', videoTrack.enabled);
        
        // Video izi aktif değilse yeniden bağlanmayı dene
        if (videoTrack.readyState === 'ended') {
            webRTCLog('Video izi sonlandırılmış, yeniden bağlanılıyor...');
            showNotification('Video bağlantısı kesildi, yeniden bağlanılıyor...');
            
            setTimeout(() => {
                cleanupScreenShare();
                if (currentRoom) {
                    socket.emit('checkActiveScreenShare', currentRoom);
                }
            }, 1000);
            return;
        }
        
        // 500ms gecikme ekleyerek tarayıcının akışı hazırlamasına zaman tanı
        setTimeout(() => {
            try {
                // Container içeriğini temizle
                videoContainer.innerHTML = '';
                
                // Yeni video elementi oluştur - srcObject kullanmadan önce DOM'a ekle
        const remoteVideo = document.createElement('video');
                remoteVideo.id = 'remoteVideo';
        remoteVideo.autoplay = true;
                remoteVideo.playsInline = true;
                remoteVideo.muted = false;
                remoteVideo.controls = true;
                remoteVideo.classList.add('remote-video');
                
                // CSS stillerini ekle
                Object.assign(remoteVideo.style, {
                    width: '100%',
                    height: '100%',
                    backgroundColor: '#000',
                    objectFit: 'contain'
                });
                
                // Önce DOM'a ekle
                videoContainer.appendChild(remoteVideo);
                
                // Sonra akışı ayarla - srcObject tarayıcılarda sorun yaşatabiliyor
                try {
                    remoteVideo.srcObject = stream;
                    webRTCLog('Video elementine srcObject atandı');
                } catch (srcErr) {
                    webRTCLog('srcObject atama hatası, alternatif yöntem deneniyor:', srcErr);
                    try {
                        remoteVideo.src = URL.createObjectURL(stream);
                        webRTCLog('Video elementine src atandı (createObjectURL ile)');
                    } catch (urlErr) {
                        webRTCLog('URL.createObjectURL hatası:', urlErr);
                        showNotification('Video gösterilemiyor: ' + urlErr.message);
                        showRetryButton();
                        return;
                    }
                }
                
                // Tarayıcı uyumluluğu için ek özellikler
                remoteVideo.setAttribute('playsinline', '');
                remoteVideo.setAttribute('webkit-playsinline', '');
                
                // Video olaylarını dinle
                remoteVideo.onloadedmetadata = () => {
                    webRTCLog('Video meta verileri yüklendi:', 
                        `Boyut: ${remoteVideo.videoWidth}x${remoteVideo.videoHeight}`);
                    
                    // Video yüklendikten sonra otomatik oynatmayı dene
                    const playPromise = remoteVideo.play();
                    if (playPromise !== undefined) {
                        playPromise
                            .then(() => {
                                webRTCLog('Video oynatma başarılı');
                                showNotification('Ekran paylaşımı görüntüleniyor');
                            })
                            .catch(e => {
                                webRTCLog('Video oynatma hatası:', e.name, e.message);
                                handleVideoPlayError(e, remoteVideo, videoContainer);
                            });
                    }
                };
                
                // Yükleme uzarsa bildirim göster
                setTimeout(() => {
                    if (remoteVideo.readyState < 3) { // HAVE_FUTURE_DATA
                        webRTCLog('Video yüklenme süresi uzun');
                        showNotification('Video yükleniyor, lütfen bekleyin...');
                    }
                }, 3000);
                
                // Ek video olayları
                remoteVideo.oncanplay = () => webRTCLog('Video oynatılabilir');
                remoteVideo.onplay = () => webRTCLog('Video oynatılmaya başladı');
                remoteVideo.onplaying = () => {
                    webRTCLog('Video oynatılıyor');
                    showNotification('Ekran paylaşımı aktif');
                };
                remoteVideo.onpause = () => webRTCLog('Video duraklatıldı');
                remoteVideo.onstalled = () => webRTCLog('Video aktarımı duraklatıldı'); 
                remoteVideo.onwaiting = () => webRTCLog('Video oynatımı için veri bekleniyor');
                
                // Video hata olayı
                remoteVideo.onerror = (e) => {
                    webRTCLog('Video oynatma hatası:', e);
                    handleVideoPlayError(e, remoteVideo, videoContainer);
                };
                
                webRTCLog('Uzak video elementi başarıyla oluşturuldu');
            } catch (e) {
                webRTCLog('Video elementi oluşturulurken iç hata:', e);
                showNotification('Video gösterme hatası: ' + e.message);
                showRetryButton();
            }
        }, 500);
    } catch (e) {
        webRTCLog('Uzak video oluşturulurken ana hata:', e);
        showNotification('Video gösterme hatası: ' + e.message);
        
        // Hata durumunda yeniden bağlanma seçeneği sun
        showRetryButton();
    }
}

// Video oynatma hatalarını yönetme
function handleVideoPlayError(error, videoElement, container) {
    webRTCLog('Video oynatma hatası yönetiliyor:', error);
    
    // Hatanın türüne göre özel işlem yap
    if (error.name === 'NotAllowedError') {
        webRTCLog('Tarayıcı otomatik oynatmaya izin vermiyor');
        showNotification('Otomatik oynatmaya izin verilmiyor, lütfen video üzerine tıklayın');
        
        // Tıklama yönergesi ekle
        const clickToPlay = document.createElement('div');
        clickToPlay.className = 'click-to-play';
        clickToPlay.innerHTML = '<p>Oynatmak için tıklayın</p>';
        
        // Tıklama olayını dinle
        clickToPlay.addEventListener('click', () => {
            // Yeniden oynatmayı dene
            const playPromise = videoElement.play();
            if (playPromise !== undefined) {
                playPromise.then(() => {
                    webRTCLog('Kullanıcı tıklamasıyla video oynatma başladı');
                    clickToPlay.remove();
                }).catch(e => {
                    webRTCLog('Tıklama sonrası da oynatma başarısız:', e);
                    showNotification('Video oynatılamıyor: ' + e.message);
                });
            }
        });
        
        container.appendChild(clickToPlay);
    } else if (error.name === 'AbortError' || error.name === 'NotSupportedError') {
        webRTCLog('Video formatı veya kodek desteklenmiyor');
        showNotification('Video formatı desteklenmiyor. Yeniden bağlanılıyor...');
        
        // Yeniden bağlanmayı dene
        setTimeout(() => {
            if (currentRoom) {
                socket.emit('checkActiveScreenShare', currentRoom);
            }
        }, 3000);
    } else {
        // Genel hata durumu
        showNotification('Video oynatma hatası: ' + (error.message || 'Bilinmeyen hata'));
        
        // 3 saniye sonra yeniden dene
        setTimeout(() => {
            if (videoElement && videoElement.paused) {
                webRTCLog('Video oynatmayı otomatik olarak yeniden deneme');
                const retryPlay = videoElement.play();
                if (retryPlay !== undefined) {
                    retryPlay.catch(e => {
                        webRTCLog('Otomatik yeniden deneme başarısız:', e);
                        showRetryButton();
                    });
                }
            }
        }, 3000);
    }
}

// Ekran paylaşımını temizle
function cleanupScreenShare() {
    webRTCLog('Ekran paylaşımı temizleniyor...');
    
    // Uzak akışı durdur
    if (remoteStream) {
        try {
            remoteStream.getTracks().forEach(track => {
                track.stop();
                webRTCLog('Uzak iz durduruldu:', track.kind);
            });
            remoteStream = null;
        } catch (e) {
            webRTCLog('Uzak akış durdurulurken hata:', e);
        }
    }
    
    // Vidyo elementlerini temizle
    const videoContainer = document.getElementById('videoContainer');
    if (videoContainer) {
        try {
            // Tüm video elementlerini bul ve temizle
            const videos = videoContainer.querySelectorAll('video');
            videos.forEach(video => {
                if (video.srcObject) {
                    video.srcObject.getTracks().forEach(track => track.stop());
                    video.srcObject = null;
                }
                video.remove();
                webRTCLog('Video elementi temizlendi');
            });
        } catch (e) {
            webRTCLog('Video elementleri temizlenirken hata:', e);
        }
    }
    
    // Peer bağlantısını kapat
    if (peerConnection) {
        webRTCLog('Peer bağlantısı kapatılıyor');
        try {
            // Gönderilenleri temizle
            const senders = peerConnection.getSenders();
            senders.forEach(sender => {
                try {
                    peerConnection.removeTrack(sender);
                } catch (e) {
                    webRTCLog('Sender temizlenirken hata:', e);
                }
            });
            
            // Bağlantıyı kapat
            peerConnection.close();
            peerConnection = null;
            webRTCLog('Peer bağlantısı kapatıldı');
        } catch (e) {
            webRTCLog('Peer bağlantısı kapatılırken hata:', e);
        }
    }
    
    webRTCLog('Ekran paylaşımı temizleme tamamlandı');
}

// Yeniden bağlanma butonu göster
function showRetryButton() {
    const videoContainer = document.getElementById('videoContainer');
    if (videoContainer) {
        videoContainer.innerHTML = `
            <div class="video-error">
                <p>Ekran paylaşımı görüntülenemiyor</p>
                <button id="retryConnection" class="btn primary">Yeniden Bağlan</button>
            </div>
        `;
        
        // Yeniden bağlanma butonu için event listener
        const retryButton = document.getElementById('retryConnection');
        if (retryButton) {
            retryButton.addEventListener('click', () => {
                showNotification('Bağlantı yeniden kuruluyor...');
                
                // Bağlantıyı temizle ve yeniden oluştur
                cleanupScreenShare();
                createPeerConnection();
                
                // Aktif ekran paylaşımı kontrolü
                if (currentRoom) {
                    socket.emit('checkActiveScreenShare', currentRoom);
                }
            });
        }
    }
}

// Odaları sunucudan al
socket.on('roomInfo', (roomData) => {
    rooms[roomData.roomId] = roomData;
});

// Bildirim gösterme fonksiyonunu geliştir
function showNotification(message, duration = 5000) {
    try {
        const notification = document.getElementById('notification') || createNotificationElement();
        notification.textContent = message;
        notification.classList.add('show');
        
        // Önceki zamanlayıcıyı temizle
        if (notification.timeout) {
            clearTimeout(notification.timeout);
        }
        
        // Belirli bir süre sonra bildirim kaybolsun
        notification.timeout = setTimeout(() => {
            notification.classList.remove('show');
        }, duration);
        
        webRTCLog('Bildirim gösterildi:', message);
    } catch (e) {
        webRTCLog('Bildirim gösterilirken hata:', e);
        console.error('Bildirim gösterilirken hata:', e);
    }
}

// Bildirim elementi yoksa oluştur
function createNotificationElement() {
    const notification = document.createElement('div');
    notification.id = 'notification';
    notification.className = 'notification';
    document.body.appendChild(notification);
    return notification;
}

// Bekleyen ICE adayları için global değişken
let pendingIceCandidates = [];

// WebRTC sinyallerini işleme fonksiyonu
function handleWebRTCSignal(signal) {
    try {
        webRTCLog('WebRTC sinyali alındı:', signal.type);
        
        if (signal.type === 'offer') {
            webRTCLog('Teklif alındı');
            handleOffer(signal.offer);
        } 
        else if (signal.type === 'answer') {
            webRTCLog('Cevap alındı');
            handleAnswer(signal.answer);
        } 
        else if (signal.type === 'ice-candidate') {
            webRTCLog('ICE adayı alındı');
            
            // ICE adaylarını uygun şekilde işle
            if (peerConnection && peerConnection.remoteDescription && peerConnection.remoteDescription.type) {
                webRTCLog('ICE adayı hemen ekleniyor');
                peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate))
                    .then(() => {
                        webRTCLog('ICE adayı başarıyla eklendi');
                    })
                    .catch(e => {
                        webRTCLog('ICE adayı eklenirken hata:', e);
                    });
            } else {
                webRTCLog('ICE adayı bekletiliyor - henüz RemoteDescription yok');
                pendingIceCandidates.push(signal.candidate);
            }
        }
        else if (signal.type === 'screen-share-started') {
            webRTCLog('Ekran paylaşımı başlatıldı sinyali alındı');
            showNotification('Ekran paylaşımı başlatıldı, bağlantı kuruluyor...');
        }
        else if (signal.type === 'screen-share-stopped') {
            webRTCLog('Ekran paylaşımı durduruldu sinyali alındı');
            cleanupScreenShare();
            showNotification('Ekran paylaşımı sonlandırıldı');
        }
        else if (signal.type === 'requestOffer') {
            webRTCLog('Teklif istendi, yeni teklif gönderiliyor...');
            // Eğer yerel akış varsa, yeni teklif gönder
            if (localStream) {
                createAndSendOffer();
            }
        }
    } catch (error) {
        webRTCLog('WebRTC sinyali işlenirken hata:', error);
    }
}

// Gelen teklifi işleme
async function handleOffer(offer) {
    try {
        webRTCLog('Gelen teklif işleniyor:', offer);
        
        if (!peerConnection) {
            webRTCLog('Yeni peer bağlantısı oluşturuluyor...');
            if (!createPeerConnection()) {
                webRTCLog('Peer bağlantısı oluşturulamadı, teklif işlenemiyor');
                return false;
            }
        }
        
        // RemoteDescription'ı ayarla
        const rtcOffer = new RTCSessionDescription(offer);
        await peerConnection.setRemoteDescription(rtcOffer);
        
        webRTCLog('Uzak açıklama başarıyla ayarlandı, cevap oluşturuluyor...');
        
        // Cevap oluştur
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        webRTCLog('Cevap oluşturuldu:', answer);
        
        // Cevabı gönder
        socket.emit('webrtcSignal', {
            type: 'answer',
            answer: peerConnection.localDescription,
            roomId: currentRoom
        });
        
        webRTCLog('Cevap gönderildi');
        
        // Uzak açıklama ayarlandığında bekleyen ICE adaylarını işle
        processPendingIceCandidates();
        
        return true;
    } catch (error) {
        webRTCLog('Teklif işlenirken hata:', error);
        showNotification('Gelen bağlantı teklifi işlenemedi: ' + error.message);
        return false;
    }
}

// Gelen cevabı işleme
async function handleAnswer(answer) {
    try {
        if (!peerConnection) {
            webRTCLog('Cevap işlenemedi: Peer bağlantısı yok');
            return false;
        }
        
        webRTCLog('Gelen cevap işleniyor:', answer);
        
        // RemoteDescription'ı ayarla
        const rtcAnswer = new RTCSessionDescription(answer);
        await peerConnection.setRemoteDescription(rtcAnswer);
        
        webRTCLog('Uzak açıklama başarıyla ayarlandı');
        
        // Uzak açıklama ayarlandığında bekleyen ICE adaylarını işle
        processPendingIceCandidates();
        
        return true;
    } catch (error) {
        webRTCLog('Cevap işlenirken hata:', error);
        showNotification('Bağlantı cevabı işlenemedi: ' + error.message);
        return false;
    }
}

// Ekran paylaşımı butonunu dinle
document.getElementById('shareScreen').addEventListener('click', startScreenShare);

// WebRTC desteğini kontrol et
if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
    webRTCLog('WebRTC destekleniyor');
} else {
    webRTCLog('WebRTC desteklenmiyor');
    document.getElementById('shareScreen').disabled = true;
    document.getElementById('shareScreen').title = 'Tarayıcınız ekran paylaşımını desteklemiyor';
}

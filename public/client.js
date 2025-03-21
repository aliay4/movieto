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
        // TURN sunucularını her zaman kullan - NAT arkasındaki cihazlar için gerekli
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
        // Ek TURN sunucuları - farklı bir servis
        {
            urls: 'turn:openrelay.metered.ca:443?transport=tcp',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        }
    ],
    iceCandidatePoolSize: 10,
    rtcpMuxPolicy: 'require',
    // TURN sunucularını kullanmayı zorla - farklı ağlardaki cihazlar için
    iceTransportPolicy: 'relay'
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
    
    // Ekran paylaşımından önce varolan bağlantıları temizle
    cleanupScreenShare();
    
    // Ekran paylaşımı yapan kullanıcıya bağlantı teklifi gönder
    webRTCLog('Ekran paylaşımı için bağlantı oluşturuluyor');
    if (createPeerConnection()) {
        // Ekran paylaşımı yapan kullanıcıya özel olarak teklif gönderiliyor
        webRTCLog('Ekran paylaşımı yapan kullanıcıya teklif gönderiliyor, userId:', userId);
        
        // Teklif göndermeden önce kısa bir gecikme ekle (bağlantı kurulması için)
        setTimeout(() => {
            createAndSendOffer(userId);
            
            // Bağlantı kurulmasını bekle ve hala bağlantı sağlanamazsa yeniden dene
            setTimeout(() => {
                // Eğer hala video görüntülenmediyse, bağlantıyı tekrar kur
                if (!document.getElementById('remoteVideo') && peerConnection) {
                    webRTCLog('Video görüntülenemedi, bağlantı yeniden kuruluyor...');
                    cleanupScreenShare();
                    createPeerConnection();
                    createAndSendOffer(userId);
                }
            }, 8000); // 8 saniye
        }, 1000);
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

// Teklif oluştur ve gönder fonksiyonunu güncelle
async function createAndSendOffer(targetUserId) {
    try {
        if (!peerConnection) {
            webRTCLog('Teklif oluşturulamadı: peerConnection yok');
            return;
        }
        
        webRTCLog('Bağlantı teklifi oluşturuluyor...');
        const offerOptions = {
            offerToReceiveAudio: true,
            offerToReceiveVideo: true,
            iceRestart: true,
            // Farklı ağlardaki cihazlar arasında bağlantı için TURN sunucularını kullan
            iceTransportPolicy: 'relay'
        };
        
        // Bağlantı durumunu kontrol et ve ICE yeniden başlatma gerekiyorsa yap
        if (peerConnection.iceConnectionState === 'failed' || 
            peerConnection.iceConnectionState === 'disconnected') {
            webRTCLog('ICE bağlantısı başarısız oldu, yeniden başlatılıyor...');
        }
        
        // Daha uzun timeout'a sahip offer oluştur
        const offer = await new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error('Offer oluşturma zaman aşımı'));
            }, 10000); // 10 saniye
            
            peerConnection.createOffer(offerOptions)
                .then(offer => {
                    clearTimeout(timeoutId);
                    resolve(offer);
                })
                .catch(err => {
                    clearTimeout(timeoutId);
                    reject(err);
                });
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
        
        webRTCLog('Bağlantı teklifi gönderildi, hedef:', targetUserId);
    } catch (error) {
        webRTCLog('Teklif oluşturulamadı:', error);
        showNotification('Bağlantı hatası: ' + error.message);
        
        // 3 saniye sonra tekrar dene
        setTimeout(() => {
            if (peerConnection && peerConnection.signalingState !== 'closed') {
                webRTCLog('Teklif oluşturma yeniden deneniyor...');
                createAndSendOffer(targetUserId);
            }
        }, 3000);
    }
}

// WebRTC sinyal işleyicisi - ekran paylaşımı yapan veya izleyen kullanıcılar için
socket.on('webrtcSignal', async (data) => {
    webRTCLog('WebRTC sinyali alındı:', data.type, 'Kimden:', data.fromUserId);
    
    // Bağlantı kontrolü ve oluşturma
    if (data.type !== 'screenShareStopped' && !peerConnection) {
        webRTCLog('Peer bağlantısı oluşturuluyor (sinyal alındığında)');
        createPeerConnection();
    }
    
    switch(data.type) {
        case 'offer':
            // Ekran paylaşımı yapan kullanıcı özel işleme
            if (localStream) {
                webRTCLog('Teklif alındı ve ekran paylaşımı aktif:', data.fromUserId);
                handleIncomingOfferWhileSharing(data);
                return;
            }
            
            // Normal teklif işleme
            try {
                webRTCLog('Teklif alındı, işleniyor...');
                
                // ICE yeniden başlatma durumunu kontrol et
                const isRestartingIce = peerConnection.signalingState === 'stable' && data.offer.sdp.indexOf('a=ice-restart') > -1;
                
                if (isRestartingIce) {
                    webRTCLog('ICE yeniden başlatma teklifi alındı...');
                }
                
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
                webRTCLog('Uzak açıklama ayarlandı, cevap oluşturuluyor...');
                
                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);
                
                webRTCLog('Teklif cevabı gönderiliyor hedef:', data.fromUserId);
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
                
                // Bağlantıyı sıfırla
                if (peerConnection) {
                    peerConnection.close();
                    peerConnection = null;
                    
                    // Yeniden deneme için bağlantıyı tekrar oluştur
                    setTimeout(() => {
                        createPeerConnection();
                        // Yeniden teklif iste
                        socket.emit('requestNewOffer', {
                            roomId: currentRoom,
                            targetUserId: data.fromUserId
                        });
                    }, 2000);
                }
            }
            break;
            
        case 'answer':
            try {
                webRTCLog('Cevap alındı, işleniyor...');
                
                // Bağlantı durumunu kontrol et
                if (peerConnection.signalingState === 'have-local-offer') {
                    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
                    webRTCLog('Bağlantı cevabı alındı ve işlendi');
                } else {
                    webRTCLog('UYARI: Bağlantı cevabı alındı ama bağlantı durumu uygun değil:', peerConnection.signalingState);
                }
            } catch (error) {
                webRTCLog('Cevap işlenemedi:', error);
                showNotification('Bağlantı hatası: ' + error.message);
            }
            break;
            
        case 'ice-candidate':
            try {
                webRTCLog('ICE adayı alındı, ekleniyor...');
                
                // ICE aday ekleme koşullarını kontrol et
                if (peerConnection.remoteDescription && peerConnection.remoteDescription.type) {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
                    webRTCLog('ICE adayı eklendi');
                } else {
                    webRTCLog('ICE adayı ertelendi - bağlantı henüz hazır değil');
                    
                    // ICE adaylarını önbelleğe almak için dizi oluştur
                    if (!window.pendingCandidates) {
                        window.pendingCandidates = [];
                    }
                    
                    // Ertelenen adayı kaydet
                    window.pendingCandidates.push(data.candidate);
                    webRTCLog('ICE adayı daha sonra eklenmek üzere kaydedildi');
                }
            } catch (error) {
                webRTCLog('ICE adayı eklenemedi:', error);
                showNotification('Bağlantı hatası: ' + error.message);
            }
            break;
            
        case 'requestNewOffer':
            // Yeni teklif isteği alındı
            if (localStream) {
                webRTCLog('Yeni teklif isteği alındı, yeni teklif gönderiliyor...');
                // 1 saniye bekle ve tekrar teklif gönder
                setTimeout(() => {
                    createAndSendOffer(data.fromUserId);
                }, 1000);
            }
            break;
            
        case 'screenShareStarted':
            webRTCLog('Ekran paylaşımı başlatıldı sinyali alındı');
            showNotification('Bir kullanıcı ekran paylaşımı başlattı');
            break;
            
        case 'screenShareStopped':
            webRTCLog('Ekran paylaşımı durduruldu sinyali alındı');
            showNotification('Ekran paylaşımı durduruldu');
            
            // Video görüntüsünü kullanıcıya bildir
            const videoContainer = document.getElementById('videoContainer');
            videoContainer.innerHTML = `
                <div class="loading-screen">
                    <p>Ekran paylaşımı sonlandırıldı</p>
                    <p>Yükleniyor...</p>
                </div>
            `;
            
            // Bağlantıları ve video elementlerini temizle
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
            break;
            
        case 'requestNewOfferFromAll':
            // Tüm kullanıcılara yeni teklif isteği alındı
            if (localStream) {
                webRTCLog('Tüm kullanıcılara yeni teklif isteği alındı');
                
                // Kısa bir gecikme ile tekrar teklif gönder
                setTimeout(() => {
                    webRTCLog('Tüm kullanıcılara yeni teklif gönderiliyor...');
                    
                    // Odada kim varsa hepsine gönder
                    // Mesajın hedef kullanıcıya ulaşması garanti değilse tüm odaya yayın yap
                    socket.emit('webrtcSignal', {
                        type: 'screenShareStarted',
                        roomId: currentRoom,
                        userId: socket.id
                    });
                    
                    // Aktif ekran paylaşımı olduğunu bildir
                    socket.emit('setActiveScreenShare', {
                        roomId: currentRoom,
                        active: true
                    });
                    
                    // Mevcut bağlantıyı yeniden yapılandır
                    setTimeout(() => {
                        cleanupScreenShare();
                        
                        // Yeni bağlantı oluştur
                        if (createPeerConnection()) {
                            // Yerel akışı ekle
                            localStream.getTracks().forEach(track => {
                                const sender = peerConnection.addTrack(track, localStream);
                                webRTCLog('Track yeniden eklendi:', track.kind);
                            });
                        }
                    }, 1000);
                }, 500);
            }
            break;
    }
    
    // Daha önce ertelenen ICE adaylarını ekle
    if (data.type === 'answer' && window.pendingCandidates && window.pendingCandidates.length > 0) {
        webRTCLog('Ertelenen ICE adayları ekleniyor, sayı:', window.pendingCandidates.length);
        
        for (const candidate of window.pendingCandidates) {
            try {
                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                webRTCLog('Ertelenen ICE adayı eklendi');
            } catch (e) {
                webRTCLog('Ertelenen ICE adayı eklenirken hata:', e);
            }
        }
        
        // Önbelleği temizle
        window.pendingCandidates = [];
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
        
        // Ekran paylaşımı için en basit ve desteklenen medya ayarları
        const mediaConstraints = {
            video: {
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                frameRate: { ideal: 30 }
            }
        };
        
        webRTCLog('Medya akışı isteniyor, kısıtlamalar:', JSON.stringify(mediaConstraints));
        
        try {
            // Önce sadece video ile dene
            localStream = await navigator.mediaDevices.getDisplayMedia(mediaConstraints);
            webRTCLog('Ekran paylaşımı akışı alındı:', 
                'Video izleri:', localStream.getVideoTracks().length,
                'Ses izleri:', localStream.getAudioTracks().length);
            
            // Video izi ayarlarını logla
            if (localStream.getVideoTracks().length > 0) {
                const videoTrack = localStream.getVideoTracks()[0];
                if (videoTrack.getSettings) {
                    const settings = videoTrack.getSettings();
                    webRTCLog('Video ayarları:', settings);
                }
            }
        } catch (err) {
            webRTCLog('Ekran paylaşımı başlatılamadı:', err);
            showNotification('Ekran paylaşımı başlatılamadı: ' + err.message);
            return false;
        }
        
        // Video elementini oluştur ve akışı bağla
        const localVideo = document.createElement('video');
        localVideo.srcObject = localStream;
        localVideo.autoplay = true;
        localVideo.muted = true; // Yerel sesi sustur, yankıyı önler
        localVideo.controls = true; // Kontroller ekle
        localVideo.style.width = '100%';
        localVideo.style.height = '100%';
        localVideo.style.backgroundColor = 'black';
        
        // Mevcut video içeriğini temizle ve ekran paylaşımını ekle
        const videoContainer = document.getElementById('videoContainer');
        videoContainer.innerHTML = '';
        videoContainer.appendChild(localVideo);
        
        // Odadaki diğer kullanıcılara sinyal gönder
        if (currentRoom) {
            webRTCLog('Ekran paylaşımı sinyali gönderiliyor...');
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
            
            showNotification('Ekran paylaşımı başlatıldı');
        } else {
            showNotification('Ekran paylaşımı başlatıldı, ancak oda bulunamadı');
        }
        
        // WebRTC bağlantısını başlat
        if (!createPeerConnection()) {
            throw new Error('Peer bağlantısı oluşturulamadı');
        }
        
        // Yerel medya akışını peer bağlantısına ekle
        webRTCLog('Yerel medya akışı peer bağlantısına ekleniyor...');
        localStream.getTracks().forEach(track => {
            try {
                const sender = peerConnection.addTrack(track, localStream);
                webRTCLog('Track eklendi:', track.kind, track.label, track.id);
            } catch (e) {
                webRTCLog('Track eklenirken hata:', e);
            }
        });
        
        // Ekran paylaşımı bittiğinde
        localStream.getVideoTracks()[0].onended = () => {
            webRTCLog('Ekran paylaşımı kullanıcı tarafından sonlandırıldı');
            stopScreenShare();
        };
        
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
                // Hedef kullanıcı bilgisi eklenmeli
                socket.emit('webrtcSignal', {
                    type: 'ice-candidate',
                    candidate: event.candidate,
                    roomId: currentRoom,
                    // ICE adayları gönderilirken tüm kullanıcılara değil, belirli bir hedefe göndermek önemli
                    targetUserId: event.candidate.targetUserId || null // Eğer gelen adaydaysa hedef kullanıcı
                });
            } else {
                webRTCLog('ICE toplama tamamlandı - tüm adaylar gönderildi');
            }
        };
        
        // ICE toplama durumunu izle
        peerConnection.onicegatheringstatechange = () => {
            webRTCLog('ICE toplama durumu:', peerConnection.iceGatheringState);
        };
        
        // ICE connection durumunu izle
        peerConnection.oniceconnectionstatechange = () => {
            webRTCLog('ICE bağlantı durumu değişti:', peerConnection.iceConnectionState);
            
            // Bağlantı durumunu kullanıcıya bildir
            if (peerConnection.iceConnectionState === 'checking') {
                webRTCLog('ICE adayları kontrol ediliyor...');
                showNotification('Bağlantı kuruluyor...', 2000);
            }
            else if (peerConnection.iceConnectionState === 'connected' || 
                peerConnection.iceConnectionState === 'completed') {
                webRTCLog('ICE bağlantısı başarılı!');
                showNotification('Bağlantı kuruldu');
                
                // Cihazın IP adresini logla (sadece debug için)
                getRTCPeerConnectionStats();
            }
            else if (peerConnection.iceConnectionState === 'failed') {
                webRTCLog('ICE bağlantısı başarısız oldu');
                showNotification('Bağlantı kurulamadı. Yeniden deneniyor...');
                
                // ICE restart denemesi
                restartIce();
            }
            else if (peerConnection.iceConnectionState === 'disconnected') {
                webRTCLog('ICE bağlantısı kesildi');
                showNotification('Bağlantı kesildi. Yeniden bağlanma deneniyor...');
                
                // Belli bir süre bekle ve bağlantı hala kesikse restart dene
                setTimeout(() => {
                    if (peerConnection && peerConnection.iceConnectionState === 'disconnected') {
                        restartIce();
                    }
                }, 2000);
            }
            else if (peerConnection.iceConnectionState === 'closed') {
                webRTCLog('ICE bağlantısı kapatıldı');
                showNotification('Bağlantı kapatıldı');
            }
        };
        
        // Bağlantı durumunu izle
        peerConnection.onconnectionstatechange = () => {
            webRTCLog('Bağlantı durumu değişti:', peerConnection.connectionState);
        };
        
        // Sinyal durumunu izle
        peerConnection.onsignalingstatechange = () => {
            webRTCLog('Sinyal durumu değişti:', peerConnection.signalingState);
        };
        
        // Bağlantı hatalarını izle
        peerConnection.onerror = (error) => {
            webRTCLog('Peer bağlantı hatası:', error);
            showNotification('Bağlantı hatası oluştu');
        };
        
        // Uzak akışı al
        peerConnection.ontrack = event => {
            webRTCLog('Uzak medya akışı alındı!');
            
            // Akış yoksa hata ver ve çık
            if (!event.streams || !event.streams[0]) {
                webRTCLog('Hata: Uzak medya akışı alınamadı veya boş');
                showNotification('Ekran paylaşımı akışı alınamadı');
                return;
            }
            
            remoteStream = event.streams[0];
            
            // Track bilgilerini detaylı logla
            const videoTracks = remoteStream.getVideoTracks();
            const audioTracks = remoteStream.getAudioTracks();
            
            webRTCLog('Akış alındı ID:', remoteStream.id);
            webRTCLog(`Video izleri: ${videoTracks.length}, Ses izleri: ${audioTracks.length}`);
            
            if (videoTracks.length > 0) {
                const videoTrack = videoTracks[0];
                webRTCLog('Video izi alındı:', videoTrack.id, videoTrack.label);
                webRTCLog('Video izi özellikleri:', 
                    'Etkin:', videoTrack.enabled, 
                    'Durumu:', videoTrack.readyState, 
                    'Muted:', videoTrack.muted);
                
                // Video ayarlarını kontrol et
                if (videoTrack.getSettings) {
                    const settings = videoTrack.getSettings();
                    webRTCLog('Video ayarları:', settings);
                }
            } else {
                webRTCLog('Uyarı: Akışta video izi bulunamadı!');
            }
            
            // Video elementini oluştur
            createRemoteVideoElement(remoteStream);
        };
        
        webRTCLog('Peer bağlantısı başarıyla oluşturuldu');
        return true;
    } catch (error) {
        webRTCLog('Peer bağlantısı oluşturulurken hata:', error);
        showNotification('Bağlantı kurulamadı: ' + error.message);
        return false;
    }
}

// Uzak video elementini oluştur ve görüntüle
function createRemoteVideoElement(stream) {
    try {
        const videoContainer = document.getElementById('videoContainer');
        if (!videoContainer) {
            webRTCLog('Hata: Video container elementi bulunamadı');
            showNotification('Video gösterilemiyor: Container elementi bulunamadı');
            return;
        }
        
        webRTCLog('Video container bulundu, video oluşturuluyor');
        
        // Önce tüm mevcut içeriği temizle
        videoContainer.innerHTML = '';
        
        // Önce DOM'a eklenecek bir div oluştur
        const videoWrapper = document.createElement('div');
        videoWrapper.style.width = '100%';
        videoWrapper.style.height = '100%';
        videoWrapper.style.position = 'relative';
        videoContainer.appendChild(videoWrapper);
        
        // Basit bir yükleniyor mesajı ekle
        const loadingMessage = document.createElement('div');
        loadingMessage.textContent = 'Video yükleniyor...';
        loadingMessage.style.position = 'absolute';
        loadingMessage.style.top = '50%';
        loadingMessage.style.left = '50%';
        loadingMessage.style.transform = 'translate(-50%, -50%)';
        loadingMessage.style.color = 'white';
        loadingMessage.style.padding = '10px';
        loadingMessage.style.background = 'rgba(0,0,0,0.5)';
        loadingMessage.style.borderRadius = '5px';
        loadingMessage.style.zIndex = '5';
        videoWrapper.appendChild(loadingMessage);
        
        // En temel video elementini oluştur
        const remoteVideo = document.createElement('video');
        remoteVideo.id = 'remoteVideo';
        remoteVideo.width = '100%';
        remoteVideo.height = '100%';
        remoteVideo.autoplay = true;
        remoteVideo.controls = true;
        remoteVideo.style.backgroundColor = 'black';
        
        // Video'yu DOM'a ekle
        videoWrapper.appendChild(remoteVideo);
        
        // Video olaylarını ekle
        remoteVideo.onloadstart = () => webRTCLog('Video yüklenmeye başladı');
        remoteVideo.onloadedmetadata = () => {
            webRTCLog('Video meta verileri yüklendi, boyut:', remoteVideo.videoWidth, 'x', remoteVideo.videoHeight);
            loadingMessage.textContent = 'Video meta verileri yüklendi, oynatılıyor...';
        };
        
        remoteVideo.oncanplay = () => {
            webRTCLog('Video oynatılabilir');
            // Yükleniyor mesajını kaldır
            loadingMessage.remove();
            
            // Oynatmayı dene
            try {
                remoteVideo.play()
                .then(() => {
                    webRTCLog('Video otomatik oynatmaya başladı');
                    showNotification('Ekran paylaşımı görüntüleniyor');
                })
                .catch(e => {
                    webRTCLog('Otomatik oynatma başarısız:', e);
                    
                    // Oynatma butonu ekle
                    const playButton = document.createElement('button');
                    playButton.textContent = 'Oynatmak için tıklayın';
                    playButton.style.position = 'absolute';
                    playButton.style.top = '50%';
                    playButton.style.left = '50%';
                    playButton.style.transform = 'translate(-50%, -50%)';
                    playButton.style.padding = '15px 30px';
                    playButton.style.background = 'red';
                    playButton.style.color = 'white';
                    playButton.style.border = 'none';
                    playButton.style.borderRadius = '5px';
                    playButton.style.cursor = 'pointer';
                    playButton.style.zIndex = '10';
                    
                    playButton.onclick = () => {
                        remoteVideo.play().catch(err => {
                            webRTCLog('Tıklama sonrası oynatma başarısız:', err);
                        });
                        playButton.remove();
                    };
                    
                    videoWrapper.appendChild(playButton);
                });
            } catch (e) {
                webRTCLog('Video oynatma hatası:', e);
            }
        };
        
        remoteVideo.onplay = () => {
            webRTCLog('Video oynatılıyor!');
            showNotification('Ekran paylaşımı başarıyla görüntüleniyor');
        };
        
        remoteVideo.onerror = (e) => {
            webRTCLog('Video hatası:', e);
            loadingMessage.textContent = 'Video yüklenirken hata: ' + (e.message || 'Bilinmeyen hata');
            
            // Yeniden bağlan butonu
            const retryButton = document.createElement('button');
            retryButton.textContent = 'Yeniden Bağlan';
            retryButton.style.display = 'block';
            retryButton.style.margin = '10px auto 0';
            retryButton.style.padding = '10px 20px';
            retryButton.style.background = 'red';
            retryButton.style.color = 'white';
            retryButton.style.border = 'none';
            retryButton.style.borderRadius = '5px';
            retryButton.style.cursor = 'pointer';
            
            retryButton.onclick = () => {
                videoContainer.innerHTML = '<div class="loading-screen"><div class="spinner"></div><p>Yeniden bağlanılıyor...</p></div>';
                cleanupScreenShare();
                setTimeout(() => {
                    createPeerConnection();
                    if (currentRoom) {
                        socket.emit('checkActiveScreenShare', currentRoom);
                    }
                }, 1000);
            };
            
            loadingMessage.appendChild(document.createElement('br'));
            loadingMessage.appendChild(retryButton);
        };
        
        // Stream'i en son ayarla
        webRTCLog('Video oluşturuldu, stream bağlanıyor');
        try {
            remoteVideo.srcObject = stream;
            webRTCLog('Video srcObject ayarlandı');
        } catch (e) {
            webRTCLog('Video srcObject ayarlaması başarısız:', e);
            
            // Alternatif yöntem: URL kullan
            try {
                remoteVideo.src = window.URL.createObjectURL(stream);
                webRTCLog('Video bağlandı (eski yöntem)');
            } catch (e2) {
                webRTCLog('Video bağlantısı tamamen başarısız:', e2);
                showNotification('Video görüntülenemiyor: ' + e2.message);
                
                // Yeniden dene butonu
                loadingMessage.textContent = 'Video bağlantısı başarısız';
                const retryButton = document.createElement('button');
                retryButton.textContent = 'Yeniden Dene';
                retryButton.style.display = 'block';
                retryButton.style.margin = '10px auto 0';
                retryButton.style.padding = '10px 20px';
                retryButton.style.background = 'red';
                retryButton.style.color = 'white';
                retryButton.style.border = 'none';
                retryButton.style.borderRadius = '5px';
                retryButton.style.cursor = 'pointer';
                
                retryButton.onclick = () => {
                    createRemoteVideoElement(stream);
                };
                
                loadingMessage.appendChild(document.createElement('br'));
                loadingMessage.appendChild(retryButton);
            }
        }
        
    } catch (error) {
        webRTCLog('Video oluşturma hatası:', error);
        showNotification('Video oluşturulamadı: ' + error.message);
        
        // Hata göster ve yeniden bağlan seçeneği sun
        const videoContainer = document.getElementById('videoContainer');
        if (videoContainer) {
            videoContainer.innerHTML = `
                <div style="width:100%; height:100%; display:flex; flex-direction:column; justify-content:center; align-items:center; background:#000; color:white; padding:20px; text-align:center;">
                    <p>Ekran paylaşımı görüntülenemiyor</p>
                    <p style="color:red; margin:10px 0;">${error.message || 'Bilinmeyen hata'}</p>
                    <button id="retryConnection" style="padding:10px 20px; background:red; color:white; border:none; border-radius:5px; cursor:pointer; margin-top:15px;">Yeniden Bağlan</button>
                </div>
            `;
            
            const retryButton = document.getElementById('retryConnection');
            if (retryButton) {
                retryButton.addEventListener('click', () => {
                    showNotification('Bağlantı yeniden kuruluyor...');
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
}

// Video oynatma hatalarını ele al
function handleVideoPlaybackError(error, container, videoElement) {
    webRTCLog('Video oynatma hatası ele alınıyor:', error);
    
    // Tarayıcının otomatik oynatma politikası hatası
    if (error.name === 'NotAllowedError') {
        showNotification('Video otomatik oynatma engellendi. Lütfen ekrana tıklayın');
        
        // Kullanıcıya daha belirgin bir tıklama talimatı göster
        if (container) {
            const clickPrompt = document.createElement('div');
            clickPrompt.className = 'click-to-play-large';
            clickPrompt.innerHTML = `
                <div class="click-message-large">
                    <i class="fas fa-play-circle"></i>
                    <p>Video oynatmak için buraya tıklayın</p>
                </div>
            `;
            
            // Tıklama işleyicisi
            clickPrompt.addEventListener('click', () => {
                if (videoElement) {
                    videoElement.play().then(() => {
                        clickPrompt.remove();
                        showNotification('Video oynatılıyor');
                    }).catch(e => {
                        webRTCLog('Tıklama sonrası oynatma hatası:', e);
                        showNotification('Video hala oynatılamıyor: ' + e.message);
                    });
                }
            });
            
            // Varsa mevcut click-to-play'i kaldır
            const existingPrompt = container.querySelector('.click-to-play, .click-to-play-large');
            if (existingPrompt) {
                existingPrompt.remove();
            }
            
            container.appendChild(clickPrompt);
        }
        
    } else {
        // Diğer oynatma hataları için yeniden bağlanma seçeneği göster
        showNotification('Video oynatılamıyor: ' + (error.message || 'Bilinmeyen hata'));
        
        if (container) {
            container.innerHTML = `
                <div class="video-error">
                    <p>Ekran paylaşımı görüntülenemiyor</p>
                    <p class="error-details">${error.message || 'Bilinmeyen hata'}</p>
                    <button id="retryConnection" class="btn primary">Yeniden Bağlan</button>
                </div>
            `;
            
            const retryButton = container.querySelector('#retryConnection');
            if (retryButton) {
                retryButton.addEventListener('click', () => {
                    showNotification('Bağlantı yeniden kuruluyor...');
                    cleanupScreenShare();
                    
                    // Bağlantıyı yeniden kur
                    setTimeout(() => {
                        createPeerConnection();
                        
                        // Aktif ekran paylaşımını kontrol et
                        if (currentRoom) {
                            socket.emit('checkActiveScreenShare', currentRoom);
                        }
                    }, 1000);
                });
            }
        }
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

// Yeni teklif isteği olayı
socket.on('requestNewOffer', (data) => {
    webRTCLog('Sunucudan yeni teklif isteği alındı');
    
    // Yerel akış ve peer bağlantısı varsa yeni teklif gönder
    if (localStream && peerConnection) {
        webRTCLog('Yerel akış var, yeni teklif gönderiliyor...');
        createAndSendOffer(data.targetUserId);
    } else {
        webRTCLog('Yerel akış yok, teklif gönderilemiyor');
    }
});

// ICE bağlantısını yeniden başlat
async function restartIce() {
    try {
        webRTCLog('ICE bağlantısı yeniden başlatılıyor...');
        
        if (peerConnection && peerConnection.signalingState !== 'closed') {
            // Yerel bir akış varsa ekran paylaşan kullanıcıyız
            if (localStream) {
                webRTCLog('Yerel akış var, yeni teklif gönderiliyor...');
                
                // Tüm kullanıcılara yeni teklif gönder
                if (currentRoom) {
                    socket.emit('webrtcSignal', {
                        type: 'requestNewOfferFromAll',
                        roomId: currentRoom,
                        userId: socket.id
                    });
                }
            } 
            // Yerel akış yoksa ekran paylaşımını izleyen kullanıcıyız
            else {
                webRTCLog('Ekran paylaşımını izliyoruz, yeni teklif isteniyor...');
                
                // Bağlantıyı yeniden kur ve aktif ekran paylaşımını kontrol et
                cleanupScreenShare();
                createPeerConnection();
                
                if (currentRoom) {
                    socket.emit('checkActiveScreenShare', currentRoom);
                }
            }
        }
    } catch (e) {
        webRTCLog('ICE restart sırasında hata:', e);
    }
}

// RTC Peer Connection istatistiklerini al
async function getRTCPeerConnectionStats() {
    if (!peerConnection) return;
    
    try {
        const stats = await peerConnection.getStats();
        let candidatePairs = [];
        let localCandidates = [];
        let remoteCandidates = [];
        
        stats.forEach(report => {
            if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                candidatePairs.push(report);
            }
            if (report.type === 'local-candidate') {
                localCandidates.push(report);
            }
            if (report.type === 'remote-candidate') {
                remoteCandidates.push(report);
            }
        });
        
        if (candidatePairs.length > 0) {
            webRTCLog('Aktif bağlantı çifti:', candidatePairs[0]);
            
            // Bağlantı türünü logla
            const localCandidate = localCandidates.find(c => c.id === candidatePairs[0].localCandidateId);
            const remoteCandidate = remoteCandidates.find(c => c.id === candidatePairs[0].remoteCandidateId);
            
            if (localCandidate && remoteCandidate) {
                webRTCLog('Bağlantı türü:', 
                    localCandidate.candidateType, '->', 
                    remoteCandidate.candidateType);
                webRTCLog('Protokol:', 
                    localCandidate.protocol, '->', 
                    remoteCandidate.protocol);
                webRTCLog('IP adresleri:', 
                    localCandidate.ip + ':' + localCandidate.port, '->',
                    remoteCandidate.ip + ':' + remoteCandidate.port);
                
                // Relay (TURN) üzerinden bağlantı kurulmuşsa bildir
                if (localCandidate.candidateType === 'relay' || remoteCandidate.candidateType === 'relay') {
                    webRTCLog('TURN sunucusu üzerinden bağlantı kuruldu');
                }
            }
        }
    } catch (e) {
        webRTCLog('İstatistikler alınırken hata:', e);
    }
}


# Senkronize Film İzleme Platformu

Bu proje, arkadaşlarınızla birlikte senkronize bir şekilde film/video izlemenizi sağlayan bir web uygulamasıdır. Oda kurup arkadaşlarınızı davet edebilir, YouTube videoları paylaşabilir ve hep birlikte senkronize bir şekilde izleyebilirsiniz.

## Özellikler

- Oda oluşturma ve katılma
- YouTube videolarını paylaşma
- Senkronize video oynatma, duraklatma ve ileri-geri alma
- Odadan ayrılma ve yeni host atama

## Kurulum

1. Projeyi bilgisayarınıza indirin
2. Gerekli bağımlılıkları yükleyin:

```bash
npm install
```

3. Sunucuyu başlatın:

```bash
npm start
```

4. Tarayıcınızda `http://localhost:3000` adresine gidin

## Kullanım

1. Ana sayfada "Yeni Oda Oluştur" butonuna tıklayarak yeni bir oda oluşturun
2. Oluşturulan oda kodunu arkadaşlarınızla paylaşın
3. Arkadaşlarınız aynı oda koduyla odaya katılabilirler
4. Oda sahibi olarak bir YouTube video URL'si veya ID'si girin ve "Videoyu Ayarla" butonuna tıklayın
5. Video oynatma, duraklatma veya ileri-geri alma işlemleri tüm katılımcılarda senkronize olarak gerçekleşecektir

## Teknolojiler

- Node.js ve Express
- Socket.io (WebSockets)
- YouTube API
- HTML, CSS, JavaScript

## Lisans

MIT

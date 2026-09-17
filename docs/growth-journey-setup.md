# Kademeli başarı yolları — kurulum ve sınırlar

Güncel devam sürümü: `growth-awards-setup.md`. Kalıcı rozet kaydı ve birleşik
Başarılar ekranı orada tanımlıdır; aşağıdaki metin ilk ilerleme sürümünün sınırlarıdır.

## Uygulanan sürüm

Altı aile: üretim (1/5/15/30), geri bildirim (1/3/5), yansıtma (5/20/50/100 gün),
yetkinlik (ilk hedef/%25/%50/tümü), birikimli süreklilik (4/8/16/24 hafta), staj
yolculuğu (hazırlık/ilk onaylı çalışma/resmî kapanış). Altı yetkinlik hedefi bulunan
uzun bir stajda 22 farklı aşama vardır. Küçük hedef kümelerinde aynı eşiğe denk
gelen yetkinlik aşamaları birleştirilir; hedef yoksa tamamlanmış sayılmaz.

Bu sürüm **doğrulanmış ilerleme ve başarı aşamalarıdır**. Yeni bir kalıcı rozet
dağıtımı/ödül bildirimi değildir. Kaynak onay geri çekilirse veya hedef değişirse
durum yeniden hesaplanır. Eski earned_badges ve XP bakiyesi korunur; hiçbir XP
kuralı veya kapanış RPC'si değiştirilmez. Kalıcı, sürümlü ödül defteri önceki tasarımın
gelecek adımıdır. Mevcut kayıtlar ilerleme hesabına katılır, geriye dönük ödül verilmez.

## Kurulum

Önce test projesinde `growth-journey-migration.sql` çalıştırılır. Mevcut görev,
staj günü, yetkinlik ve XP tabloları/RPC'leri önkoşuldur. Staj kapanışı isteğe bağlıdır;
tablosu yoksa yalnızca kapanış aşaması kullanılamaz (`closed: null`). Script
transaction içindedir ve tekrar uygulanabilir. Eski kayıt silmez; yalnızca yeni
izleme tabloları, durum değişimi trigger'ı ve öğrenciye özel okuma RPC'si ekler.
Canlıya uygulama kullanıcı tarafından yapılır. Ardından
`growth-journey-verification.sql` ayrı sorgular halinde çalıştırılır.

Yeni izleme tablolarında doğrudan istemci erişimi kapalıdır. RPC başka öğrenci
kimliği almaz; auth.uid() ve student rolünü doğrular. Birden fazla aktif üyelik
varsa rastgele grup seçmez, hata verir. Veri yükleme hatası sıfır ilerleme değildir.
Migration henüz uygulanmamışsa ekranda kurulum uyarısı çıkar; eski XP/rozetler açılır.

## Kurallar ve bilinçli sınırlar

- Grup bazında yalnızca yayımlanmış, halen onaylı farklı görevler sayılır.
- Geri bildirim isteğe bağlıdır ve önerilen üç hedef arasına sokulmaz. İlk onay
  öncesi gerekçeli düzeltme, yeniden gönderim ve onay yeni izleme kayıtlarıyla
  doğrulanır. Geçmiş revizyonlar tahmin edilmez; eski onayların yeniden açılması
  ilk geri bildirim başarısı üretmez. Tekrar onay sayıyı artırmaz.
- Günlük, gönderilmiş ve dolu olmalı; katılım present/partial olmalı ve açık
  düzeltme talebi bulunmamalıdır. Beş farklı tarih sayılır; çalışma saati değildir.
- Haftalar birikimlidir. Görev için değişebilir submitted_at yerine ilk gönderim
  XP işleminin UTC haftası; günlük için placement'ın yerel day_date haftası alınır.
  Aynı ISO hafta tek sayılır. İki kaynak farklı saat bağlamlarından gelir; bu
  yöntem katılım saati kanıtı değildir. Tatil/izin boşluğu ilerlemeyi sıfırlamaz.
- Görev kapasitesi yayımlanmış görev sayısıdır. Süre kapasitesi öğrencinin mevcut
  başlangıç/bitiş tarihleri arasındaki takvim aralığıdır, iş günü garantisi değildir.
  Tatillerin veya çalışma günlerinin planı bulunmadığından uygunluk yalnızca üst
  sınır filtresidir; görev takvimi ve kişisel çalışma planına göre hedef ataması
  henüz yapılmaz. Üst aşamalar zorunlu tamamlanma oranına dönüştürülmez.
- Yetkinlikler resmi get_competency_progress hesabını aynen kullanır. Hedef
  düşürmek mevcut ilerlemeyi değiştirebilir; bu sürüm bunun için kalıcı ödül vermez.
- Ayrı bir ara değerlendirme olayı olmadığından bu adla rozet sunulmaz. Yolculukta
  ilk mentor onayı kullanılır. Kapanış rapor sürümüne bağlıdır; yeniden açılınca
  kapanış aşaması tekrar tamamlanmamış görünür. Kapalı stajda yeni hedef önerilmez.
- Eski grupların aile ilerlemesi için arşiv seçici bu sürümde yoktur; görünüm mevcut
  üyeliğin grubunu gösterir. Kalıcı eski rozetler ayrı bölümde korunur.

## Doğrulama

- `node node_modules/typescript/bin/tsc --noEmit`
- `node node_modules/jest/bin/jest.js --runInBand`
- `node scripts/test-growth-journey.cjs <PGlite paket yolu>`

SQL testi izole PostgreSQL ve sahte önkoşul şeması kullanır; canlı şema ve cihaz
testinin yerine geçmez. Expo Go'da 6/12 aylık ve kısa staj, 0/2/30 görev, farklı
yetkinlik hedef sayıları, internet hatası, aileleri aç/kapat, büyük yazı/dar ekran,
onay geri alma, grup değişimi ve stajın kapanıp yeniden açılması denenmelidir.

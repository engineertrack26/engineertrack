# XP gelişim aşamaları

Seviyeler mesleki unvan değil, birikmiş XP yolculuğudur. Yetkinlik değerlendirmesi,
doğrulanmış başarı rozetleri ve staj kapanışı ayrı kalır. Aşama adı, belirli bir
becerinin kazanıldığı, düzenli devam edildiği veya mezuniyet anlamına gelmez.

| Aşama | Ad | Toplam XP eşiği |
| --- | --- | ---: |
| 1 | İlk Adım | 0 |
| 2 | Keşif | 100 |
| 3 | Katılım | 300 |
| 4 | Pratik | 600 |
| 5 | İlerleme | 1000 |
| 6 | Katkı | 1500 |
| 7 | Gelişen Deneyim | 2100 |
| 8 | Birikim | 2800 |
| 9 | Güçlü Birikim | 3600 |
| 10 | Yeni Ufuklar | 4500 |

## Sunum

Gelişim kartı mevcut aşamayı, toplam XP'yi, sıradaki aşamaya kalan XP'yi ve
yetkinlikten farkını gösterir. Açılır yol haritası tüm eşikleri, mevcut/geçilmiş/
gelecek aşamaları ve XP kurallarını açıklar. Bilgi yalnızca renkle aktarılmaz.
Son aşama öğrenmenin sonu değildir; XP birikimi ve başarı rozetleri devam eder.
Yedi dilde adlar güncellendi; eski çeviri anahtarları uyumluluk için korundu.

## Ekonomi ve kapsam

Bu sürüm XP dağıtımını ve eşikleri değiştirmez; SQL gerektirmez.
Gönderim başına ilk gönderim 10 XP, ilk onay 20 XP; ilk gönderimdeki görev
fotoğrafları başına 3 XP, toplam en fazla 15 XP mevcut sunucu kuralıdır.
Yeni staj günlükleri ve başarı rozetleri ek XP vermez. Geçmiş XP toplamda kalır.

Sırf staj süresi 6–12 ay olduğu için tüm kullanıcıların son aşamaya ulaşacağı
vaat edilmez. Fotoğrafsız 30 XP'lik gönderim+onay döngüsünde 4500 XP yaklaşık
150 görev, azami fotoğraf bonusuyla 100 görev gerektirir (eski XP hariç).
Bu bir görev kotası veya fotoğraf yükleme önerisi değildir. Yeni eşik kalibrasyonu
gerçek görev sayısı/sıklığı dağılımıyla ayrıca yapılmalı; istemci ve sunucu
calculate_level aynı anda güncellenmelidir. Bu sürüm böyle bir kalibrasyon yapmaz.

## Expo Go kontrolü

- Gelişim: aşama adı, sıradaki hedef ve açıklama görünür.
- Yol haritasını aç/kapat; mevcut aşama metin ve simgeyle ayırt edilir.
- Yedi dilde hiçbir ham çeviri anahtarı görünmemeli.
- Küçük ekran/büyük yazı: adlar ve açıklamalar sarılır, sabit satır yüksekliği yoktur.
- 4500+ XP: sonsuz hedef yerine devam mesajı görünür.
- Başarılar / Yetkinliklerim / XP geçmişi sekmeleri çalışmaya devam eder.

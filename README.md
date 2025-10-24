# WME Väylävirasto

Suomen Väyläviraston WMS-tasot Waze Map Editoria varten.

## Kuvaus

Tämä userscript lisää Waze Map Editoriin Suomen Väyläviraston avoimen datan WMS-tasoja, jotka auttavat kartan editoinnissa. Skripti tarjoaa modernin sivupaneeli-käyttöliittymän ja dynaamisen tasojen latauksen WMS GetCapabilities -pyynnön kautta.

## Ominaisuudet

### Dynaaminen tasojen lataus:
- **Automaattinen tasojen haku** WMS GetCapabilities -pyynnön kautta
- **Kaikki saatavilla olevat tasot** Väyläviraston WMS-palvelusta
- **Fallback-tasot** jos GetCapabilities epäonnistuu
- **Reaaliaikainen tasojen tila** ja metatiedot

### Käyttöliittymä:
- **Integroitu sivupaneeli** WME:n vasemmassa sivupalkissa (🇫🇮 -välilehti)
- **Kelluva pika-aktivointi painike** vedettävällä käyttöliittymällä
- **Hakutoiminto** tasojen suodattamiseen
- **Aktiiviset tasot -osio** näyttää tällä hetkellä näkyvät tasot
- **Pika-aktivointi** usein käytettyjen tasojen nopeaan hallintaan
- **Läpinäkyvyyssäätimet** aktiivisille tasoille
- **Selite-ikkunat** (ℹ️ -painike) WMS-legendojen näyttämiseen

### Edistyneet ominaisuudet:
- **Automaattinen asetusten tallennus** LocalStorage-muistiin
- **Tasojen tilan palauttaminen** sivun uudelleenlatauksen jälkeen
- **Virheenkäsittely** ja automaattinen uudelleenyritys

## Asennus

1. Asenna userscript-manageri (esim. Tampermonkey, Greasemonkey)
2. Klikkaa [tästä linkistä](WME_Vaylavirasto.js) asentaaksesi skriptin
3. Hyväksy asennus userscript-managerissa

## Käyttö

### Sivupaneeli (suositeltu):
1. Avaa Waze Map Editor
2. Odota että skripti latautuu ja hakee saatavilla olevat tasot
3. Klikkaa **🇫🇮 -välilehteä** vasemmassa sivupalkissa
4. **Hae tasoja** hakukentän avulla
5. **Valitse tasot** checkboxeilla aktivoidaksesi ne
6. **Säädä läpinäkyvyyttä** aktiivisten tasojen liukusäätimillä
7. **Lisää pika-aktivointiin** ☆-painikkeella usein käytetyt tasot
8. **Näytä selitteet** ℹ️-painikkeella

### Kelluva pika-aktivointi:
1. **Klikkaa 🇫🇮 -painiketta** kartalla avataksesi pika-aktivointi valikon
2. **Valitse tasot** suoraan kelluvasta valikosta
3. **Vedä painiketta** siirtääksesi sen haluamaasi paikkaan
4. **Hallinnoi tasoja** sivupaneelista lisätäksesi pika-aktivointiin

## Tekniset tiedot

- **Versio:** 2.0.0
- **Tietolähde:** Väylävirasto Avoin API
- **WMS-palvelu:** https://avoinapi.vaylapilvi.fi/vaylatiedot/wms
- **Koordinaattijärjestelmä:** EPSG:3857 (Web Mercator)
- **Kuvaformaatti:** PNG (läpinäkyvä)
- **Dynaaminen lataus:** WMS GetCapabilities v1.3.0
- **Selitteet:** WMS GetLegendGraphic -pyyntöjen kautta
- **Tallennustila:** LocalStorage (asetukset, aktiiviset tasot, pika-aktivointi)
- **Rate limiting -suojaus:** Automaattinen pyyntöjen rajoitus ja uudelleenyritys

## Vianmääritys

### Tasot eivät näy:
1. Tarkista että **🇫🇮 -välilehti** on näkyvissä sivupalkissa
2. Varmista että tasot on **aktivoitu checkboxeilla**
3. Tarkista **läpinäkyvyysasetukset** (eivät saa olla 0%)
4. Avaa selaimen kehittäjätyökalut (F12) ja tarkista Console-välilehti

### GetCapabilities-ongelmat:
- Jos dynaaminen lataus epäonnistuu, skripti käyttää fallback-tasoja
- Tarkista verkkoyhteytesi Väylävirasto-palveluun
- CORS-rajoitukset voivat estää GetCapabilities-pyynnön

### Yleisiä ongelmia:
- **Sivupaneeli ei näy:** Varmista että WME on ladannut kokonaan
- **Asetukset katoavat:** Tarkista selaimen LocalStorage-asetukset
- **Kelluva painike katoaa:** Päivitä sivu tai luo uusi painike sivupaneelista
- **Rate limiting:** Nopea panorointi/zoomaus voi aiheuttaa tilapäisiä viiveitä

## Lisenssi

MIT License - Käytä vapaasti ja muokkaa tarpeidesi mukaan.

## Tekijä

- **Stemmi** - Alkuperäinen kehittäjä

## Tietolähde

Tiedot ovat peräisin Väyläviraston avoimesta datasta:
- [Väylävirasto Avoin API](https://avoinapi.vaylapilvi.fi/)
- [Digiroad-tietokanta](https://www.digiroad.fi/)

## Changelog

### v2.0.0 - Suuri päivitys
- **🆕 Integroitu sivupaneeli:** WME:n natiivi sivupalkki-integraatio
- **🆕 Dynaaminen tasojen lataus:** Automaattinen WMS GetCapabilities -haku
- **🆕 Hakutoiminto:** Tasojen suodatus nimen, abstraktin tai teknisen nimen perusteella
- **🆕 Aktiiviset tasot -osio:** Erillinen näkymä tällä hetkellä aktiivisille tasoille
- **🆕 Pika-aktivointi järjestelmä:** Usein käytettyjen tasojen nopea hallinta
- **🆕 Automaattinen asetusten tallennus:** LocalStorage-pohjainen muisti
- **🆕 Tasojen tilan palauttaminen:** Aktiiviset tasot palautetaan sivun latauksen jälkeen
- **🆕 Läpinäkyvyyssäätimet:** Reaaliaikaiset opacity-säätimet aktiivisille tasoille
- **🆕 Parannettu käyttöliittymä:** Modernimpi ja käyttäjäystävällisempi design
- **🆕 Fallback-järjestelmä:** Toimii vaikka GetCapabilities epäonnistuisi

### v1.5
- **Rate limiting -suojaus:** Automaattinen pyyntöjen rajoitus estää palvelimen ylikuormituksen
- **Suuremmat tile-koot:** 512x512 pikseliä vähentää pyyntöjen määrää
- **Älykkäät puskurit:** Vähentää uudelleenlatauksia panoroinnin aikana
- **Debounced-päivitykset:** Odottaa 500ms kartan liikkumisen päättymisen jälkeen
- **Automaattinen uudelleenyritys:** Rate limit -virheiden (HTTP 429/503) automaattinen korjaus
- **Optimoitu 4K-näytöille:** Erityisesti 2160p-resoluutiolle optimoitu

### v1.4
- Lisätty selite-toiminnallisuus (ℹ️ -painike)
- Kelluva selite-ikkuna WMS-legendoille
- Vedettävät selite-ikkunat
- Parannettu käyttöliittymä tasojen hallintaan

### v1.3
- Lisätty selite-painikkeet tasoille
- Parannettu käyttökokemus

### v1.2
- Parannettu virheenkäsittely
- Lisätty drag & drop -toiminnallisuus
- Päivitetty käyttöliittymä
- Korjattu WMS-parametrit GetCapabilities-vastauksen perusteella

---

**Huom:** Tämä työkalu on tarkoitettu Waze Map Editor -käyttäjille Suomessa. Varmista että noudatat Wazen editointisääntöjä käyttäessäsi ulkoisia tietolähteitä.
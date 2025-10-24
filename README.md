# WME Väylävirasto

Suomen Väyläviraston WMS-tasot Waze Map Editoria varten.

## Kuvaus

Tämä userscript lisää Waze Map Editoriin Suomen Väyläviraston avoimen datan WMS-tasoja, jotka auttavat kartan editoinnissa. Skripti tarjoaa helppokäyttöisen käyttöliittymän tasojen hallintaan.

## Ominaisuudet

### Saatavilla olevat tasot:
- **Liikennemäärät 2023** - Tietoja liikennemääristä teillä
- **Nopeusrajoitukset** - Voimassa olevat nopeusrajoitukset
- **Liikennemerkit** - Liikennemerkkien sijainnit
- **Päällystetyt tiet** - Tieto teiden päällystetyypistä
- **Talvinopeusrajoitus** - Talviaikaiset nopeusrajoitukset
- **Nopeusrajoituspäätökset** - Viranomaispäätökset nopeusrajoituksista

### Käyttöliittymä:
- 🇫🇮 -painike kartan vasemmassa yläkulmassa
- Vedettävä ja siirrettävä käyttöliittymä
- Yksinkertainen checkbox-pohjainen tasojen hallinta
- ℹ️ -painike jokaisen tason vieressä selitteen näyttämiseen
- Kelluva selite-ikkuna WMS-legendoille
- Ennalta määritetyt läpinäkyvyysarvot tasoille
- **Automaattinen rate limiting -suojaus** estää palvelimen ylikuormituksen

## Asennus

1. Asenna userscript-manageri (esim. Tampermonkey, Greasemonkey)
2. Klikkaa [tästä linkistä](WME_Vaylavirasto.js) asentaaksesi skriptin
3. Hyväksy asennus userscript-managerissa

## Käyttö

1. Avaa Waze Map Editor
2. Odota että skripti latautuu (näet konsoli-viestejä)
3. Klikkaa 🇫🇮 -painiketta avataksesi tasovalikon
4. Valitse haluamasi tasot checkboxeilla
5. Klikkaa ℹ️ -painiketta nähdäksesi tason selitteen
6. Vedä painiketta tai selite-ikkunoita siirtääksesi niitä

## Tekniset tiedot

- **Versio:** 1.5
- **Tietolähde:** Väylävirasto Avoin API
- **WMS-palvelu:** https://avoinapi.vaylapilvi.fi/vaylatiedot/wms
- **Koordinaattijärjestelmä:** EPSG:3857 (Web Mercator)
- **Kuvaformaatti:** PNG (läpinäkyvä)
- **Selitteet:** WMS GetLegendGraphic -pyyntöjen kautta
- **Rate limiting -suojaus:** Automaattinen pyyntöjen rajoitus ja uudelleenyritys

## Vianmääritys

### Tasot eivät näy:
1. Tarkista että olet oikealla zoomitasolla
2. Avaa selaimen kehittäjätyökalut (F12)
3. Tarkista Network-välilehti WMS-pyyntöjen varalta
4. Katso Console-välilehti virheviesteistä

### Yleisiä ongelmia:
- Jotkut tasot näkyvät vain tietyillä zoomitasoilla
- Verkko-ongelmat voivat estää tasojen latautumisen
- CORS-rajoitukset voivat aiheuttaa ongelmia
- **Rate limiting:** Nopea panorointi/zoomaus voi aiheuttaa tilapäisiä viiveitä (v1.5 sisältää automaattisen suojauksen)

## Lisenssi

MIT License - Käytä vapaasti ja muokkaa tarpeidesi mukaan.

## Tekijä

- **Stemmi** - Alkuperäinen kehittäjä

## Tietolähde

Tiedot ovat peräisin Väyläviraston avoimesta datasta:
- [Väylävirasto Avoin API](https://avoinapi.vaylapilvi.fi/)
- [Digiroad-tietokanta](https://www.digiroad.fi/)

## Changelog

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
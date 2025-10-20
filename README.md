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
- Ennalta määritetyt läpinäkyvyysarvot tasoille

## Asennus

1. Asenna userscript-manageri (esim. Tampermonkey, Greasemonkey)
2. Klikkaa [tästä linkistä](WME_Vaylavirasto.js) asentaaksesi skriptin
3. Hyväksy asennus userscript-managerissa

## Käyttö

1. Avaa Waze Map Editor
2. Odota että skripti latautuu (näet konsoli-viestejä)
3. Klikkaa 🇫🇮 -painiketta avataksesi tasovalikon
4. Valitse haluamasi tasot checkboxeilla
5. Vedä painiketta siirtääksesi käyttöliittymää

## Tekniset tiedot

- **Versio:** 1.2
- **Tietolähde:** Väylävirasto Avoin API
- **WMS-palvelu:** https://avoinapi.vaylapilvi.fi/vaylatiedot/wms
- **Koordinaattijärjestelmä:** EPSG:3857 (Web Mercator)
- **Kuvaformaatti:** PNG (läpinäkyvä)

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

## Lisenssi

Tämä projekti on avoimen lähdekoodin projekti. Käytä vapaasti ja muokkaa tarpeidesi mukaan.

## Tekijä

- **Stemmi** - Alkuperäinen kehittäjä

## Tietolähde

Tiedot ovat peräisin Väyläviraston avoimesta datasta:
- [Rajapinnat - Väylävirasto]([https://avoinapi.vaylapilvi.fi/](https://vayla.fi/vaylista/aineistot/avoindata/rajapinnat))
- [Digiroad-tietokanta](https://www.digiroad.fi/)

## Changelog

### v1.2
- Parannettu virheenkäsittely
- Lisätty drag & drop -toiminnallisuus
- Päivitetty käyttöliittymä
- Korjattu WMS-parametrit GetCapabilities-vastauksen perusteella

---

**Huom:** Tämä työkalu on tarkoitettu Waze Map Editor -käyttäjille Suomessa. Varmista että noudatat Wazen editointisääntöjä käyttäessäsi ulkoisia tietolähteitä.

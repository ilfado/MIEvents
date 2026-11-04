export interface VenuePinPoint {
  lat: number;
  lon: number;
  address: string;
  city: string;
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const PINS: [string, VenuePinPoint][] = [
  ["base milano", { lat: 45.4509, lon: 9.1587, address: "Via Tortona 40, 20144 Milano", city: "MILANO" }],
  ["magazzini generali", { lat: 45.4441, lon: 9.1953, address: "Via Pietrasanta 16, 20141 Milano", city: "MILANO" }],
  ["alcatraz", { lat: 45.4946, lon: 9.1825, address: "Via Valtellina 25, 20159 Milano", city: "MILANO" }],
  ["fabrique", { lat: 45.4593, lon: 9.2255, address: "Via Fantoli 28, 20138 Milano", city: "MILANO" }],
  ["santeria toscana 31", { lat: 45.4456408, lon: 9.1883503, address: "Viale Toscana 31, 20145 Milano", city: "MILANO" }],
  ["santeria toscana", { lat: 45.4456408, lon: 9.1883503, address: "Viale Toscana 31, 20145 Milano", city: "MILANO" }],
  ["santeria paladini 8", { lat: 45.4698063, lon: 9.2345112, address: "Via Paladini 8, 20143 Milano", city: "MILANO" }],
  ["santeria paladini", { lat: 45.4698063, lon: 9.2345112, address: "Via Paladini 8, 20143 Milano", city: "MILANO" }],
  ["santeria", { lat: 45.4456408, lon: 9.1883503, address: "Viale Toscana 31, 20145 Milano", city: "MILANO" }],  // default = Toscana 31
  ["circolo magnolia", { lat: 45.4789, lon: 9.2389, address: "Via Circonvallazione Idroscalo 41, Segrate (MI)", city: "SEGRATE" }],
  ["magnolia", { lat: 45.4789, lon: 9.2389, address: "Via Circonvallazione Idroscalo 41, Segrate (MI)", city: "SEGRATE" }],
  ["leoncavallo", { lat: 45.5021, lon: 9.2243, address: "Via Antoine Watteau 7, 20159 Milano", city: "MILANO" }],
  ["spazio leoncavallo", { lat: 45.5021, lon: 9.2243, address: "Via Antoine Watteau 7, 20159 Milano", city: "MILANO" }],
  ["carroponte", { lat: 45.4962, lon: 9.2189, address: "Via Luigi Granelli 1, 20099 Sesto San Giovanni (MI)", city: "SESTO SAN GIOVANNI" }],
  ["teatro degli arcimboldi", { lat: 45.5086, lon: 9.2084, address: "Viale dell'Innovazione 20, 20126 Milano", city: "MILANO" }],
  ["arcimboldi", { lat: 45.5086, lon: 9.2084, address: "Viale dell'Innovazione 20, 20126 Milano", city: "MILANO" }],
  ["teatro carcano", { lat: 45.4562, lon: 9.1969, address: "Corso di Porta Romana 63, 20122 Milano", city: "MILANO" }],
  ["carcano", { lat: 45.4562, lon: 9.1969, address: "Corso di Porta Romana 63, 20122 Milano", city: "MILANO" }],
  ["teatro franco parenti", { lat: 45.4508, lon: 9.1912, address: "Via Pier Lombardo 14, 20135 Milano", city: "MILANO" }],
  ["franco parenti", { lat: 45.4508, lon: 9.1912, address: "Via Pier Lombardo 14, 20135 Milano", city: "MILANO" }],
  ["elfo puccini", { lat: 45.4722, lon: 9.2044, address: "Corso Buenos Aires 33, 20124 Milano", city: "MILANO" }],
  ["teatro elfo puccini", { lat: 45.4722, lon: 9.2044, address: "Corso Buenos Aires 33, 20124 Milano", city: "MILANO" }],
  ["teatro menotti", { lat: 45.4333, lon: 9.1719, address: "Via Carlo Scarpellini 4, 20146 Milano", city: "MILANO" }],
  ["menotti", { lat: 45.4333, lon: 9.1719, address: "Via Carlo Scarpellini 4, 20146 Milano", city: "MILANO" }],
  ["teatro out off", { lat: 45.4933, lon: 9.2017, address: "Via Mac Mahon 16, 20145 Milano", city: "MILANO" }],
  ["out off", { lat: 45.4933, lon: 9.2017, address: "Via Mac Mahon 16, 20145 Milano", city: "MILANO" }],
  ["zona k", { lat: 45.4489, lon: 9.1711, address: "Via Tortona 31, 20144 Milano", city: "MILANO" }],
  ["fabbrica del vapore", { lat: 45.4789, lon: 9.1694, address: "Via Giulio Cesare Procaccini 4, 20154 Milano", city: "MILANO" }],
  ["hangar bicocca", { lat: 45.5083, lon: 9.2139, address: "Via Chiese 2, 20126 Milano", city: "MILANO" }],
  ["hangarbicocca", { lat: 45.5083, lon: 9.2139, address: "Via Chiese 2, 20126 Milano", city: "MILANO" }],
  ["blue note milano", { lat: 45.4672, lon: 9.1886, address: "Via Borsieri 37, 20125 Milano", city: "MILANO" }],
  ["blue note", { lat: 45.4672, lon: 9.1886, address: "Via Borsieri 37, 20125 Milano", city: "MILANO" }],
  ["unipol forum", { lat: 45.4015, lon: 9.1423, address: "Via G. Di Vittorio 6, 20057 Assago (MI)", city: "ASSAGO" }],
  ["mediolanum forum", { lat: 45.4015, lon: 9.1423, address: "Via G. Di Vittorio 6, 20057 Assago (MI)", city: "ASSAGO" }],
  ["forum di milano", { lat: 45.4015, lon: 9.1423, address: "Via G. Di Vittorio 6, 20057 Assago (MI)", city: "ASSAGO" }],
  ["unipol dome", { lat: 45.4016, lon: 9.1420, address: "Via Giuseppe di Vittorio 6, 20057 Assago (MI)", city: "ASSAGO" }],  // Unipol Forum/Dome, Assago
  ["duomo di milano", { lat: 45.4642, lon: 9.1900, address: "Piazza del Duomo, 20122 Milano", city: "MILANO" }],
  ["duomo", { lat: 45.4642, lon: 9.1900, address: "Piazza del Duomo, 20122 Milano", city: "MILANO" }],
  ["cattedrale di milano", { lat: 45.4642, lon: 9.1900, address: "Piazza del Duomo, 20122 Milano", city: "MILANO" }],
  ["basilica di sant'eustorgio", { lat: 45.4537, lon: 9.1810, address: "Piazza Sant'Eustorgio 1, 20122 Milano", city: "MILANO" }],
  ["sant'eustorgio", { lat: 45.4537, lon: 9.1810, address: "Piazza Sant'Eustorgio 1, 20122 Milano", city: "MILANO" }],
  ["basilica di san vittore al teatro", { lat: 45.4633, lon: 9.1769, address: "Via San Vittore al Teatro 14, 20123 Milano", city: "MILANO" }],
  ["castello sforzesco", { lat: 45.4675, lon: 9.1795, address: "Piazza Castello 1, 20121 Milano", city: "MILANO" }],
  ["sforzesco", { lat: 45.4675, lon: 9.1795, address: "Piazza Castello 1, 20121 Milano", city: "MILANO" }],
  ["teatro alla scala", { lat: 45.4678, lon: 9.1896, address: "Piazza della Scala 1, 20121 Milano", city: "MILANO" }],
  ["la scala", { lat: 45.4678, lon: 9.1896, address: "Piazza della Scala 1, 20121 Milano", city: "MILANO" }],
  ["piccolo teatro", { lat: 45.4686, lon: 9.1947, address: "Via Rovello 2, 20121 Milano", city: "MILANO" }],
  ["triennale milano", { lat: 45.4722, lon: 9.1733, address: "Viale Emilio Alemagna 6, 20121 Milano", city: "MILANO" }],
  ["triennale", { lat: 45.4722, lon: 9.1733, address: "Viale Emilio Alemagna 6, 20121 Milano", city: "MILANO" }],
  ["galleria vittorio emanuele ii", { lat: 45.4656, lon: 9.1899, address: "Piazza del Duomo, 20123 Milano", city: "MILANO" }],
  ["arena civica", { lat: 45.4789, lon: 9.1864, address: "Via Byron 2, 20151 Milano", city: "MILANO" }],
  ["parco sempione", { lat: 45.4706, lon: 9.1828, address: "Piazza Sempione, 20145 Milano", city: "MILANO" }],
  ["idroscalo", { lat: 45.4789, lon: 9.2389, address: "Via Circonvallazione Idroscalo, Segrate (MI)", city: "SEGRATE" }],
  ["cascina nascosta", { lat: 45.4856, lon: 9.1711, address: "Via Tartaglia 20, 20154 Milano", city: "MILANO" }],
  ["mare culturale urbano", { lat: 45.4856, lon: 9.1711, address: "Via Tartaglia 20, 20154 Milano", city: "MILANO" }],
  ["auditorium san fedele", { lat: 45.4663, lon: 9.1920, address: "Piazza San Fedele 4, 20121 Milano", city: "MILANO" }],
  ["san fedele", { lat: 45.4663, lon: 9.1920, address: "Piazza San Fedele 4, 20121 Milano", city: "MILANO" }],
  ["darsena", { lat: 45.4515, lon: 9.1735, address: "Darsena, Porta Ticinese, 20143 Milano", city: "MILANO" }],
  ["darsena milano", { lat: 45.4515, lon: 9.1735, address: "Darsena, Porta Ticinese, 20143 Milano", city: "MILANO" }],
  ["los chicos", { lat: 45.4615, lon: 9.1935, address: "Via Maroncelli 19, 20123 Milano", city: "MILANO" }],
  ["teatro della quattordicesima", { lat: 45.4530, lon: 9.2050, address: "Via Olio 18, Milano", city: "MILANO" }],
  ["teatro xiv", { lat: 45.4530, lon: 9.2050, address: "Via Olio 18, Milano", city: "MILANO" }],
  ["associazione culturale cea", { lat: 45.4820, lon: 9.2280, address: "Via Tadino 3, 20131 Milano", city: "MILANO" }],
  ["c e a", { lat: 45.4820, lon: 9.2280, address: "Via Tadino 3, 20131 Milano", city: "MILANO" }],
  ["cea", { lat: 45.4820, lon: 9.2280, address: "Via Tadino 3, 20131 Milano", city: "MILANO" }],
  ["casa cardinale ildefonso schuster", { lat: 45.4680, lon: 9.1840, address: "Via Sant'Antonio 5, 20122 Milano", city: "MILANO" }],
  ["casa delle zucche", { lat: 45.0660, lon: 7.3890, address: "Via Vittorio Emanuele 69, 10020 Andezeno (TO)", city: "ANDEZENO" }],
  ["legend club", { lat: 45.5162, lon: 9.1793, address: "Viale Enrico Fermi 98, 20161 Milano", city: "MILANO" }],
  ["legend club milano", { lat: 45.5162, lon: 9.1793, address: "Viale Enrico Fermi 98, 20161 Milano", city: "MILANO" }],
  ["land club", { lat: 45.5867, lon: 8.8982, address: "Via Maestri del Lavoro 27, 20025 Legnano (MI)", city: "LEGNANO" }],
  ["land club legnano", { lat: 45.5867, lon: 8.8982, address: "Via Maestri del Lavoro 27, 20025 Legnano (MI)", city: "LEGNANO" }],
  ["land legnano", { lat: 45.5867, lon: 8.8982, address: "Via Maestri del Lavoro 27, 20025 Legnano (MI)", city: "LEGNANO" }],
  ["santuario don gnocchi", { lat: 45.4490, lon: 9.1240, address: "Via Alfonso Capecelatro 70, 20153 Milano", city: "MILANO" }],
  ["don gnocchi", { lat: 45.4490, lon: 9.1240, address: "Via Alfonso Capecelatro 70, 20153 Milano", city: "MILANO" }],
];

const PIN_INDEX = new Map(PINS.map(([key, pin]) => [norm(key), pin]));

export function pinForVenue(venue: string | null, address: string | null = null): VenuePinPoint | null {
  if (venue) {
    const v = norm(venue);
    const exact = PIN_INDEX.get(v);
    if (exact) return exact;
    const vTokens = v.split(" ");
    const matches: Array<[string, VenuePinPoint]> = [];
    for (const [key, pin] of PIN_INDEX) {
      const kTokens = key.split(" ");
      const specificity = kTokens.filter((t) => t.length >= 3 && vTokens.includes(t)).length;
      const exactSubstring = v.includes(key);
      if (specificity >= 2 || (kTokens.length >= 2 && kTokens.every((t) => vTokens.includes(t))) || (key.length >= 6 && exactSubstring)) {
        matches.push([key, pin]);
      }
    }
    if (matches.length > 0) {
      matches.sort((a, b) => b[0].length - a[0].length || a[0].localeCompare(b[0]));
      return matches[0][1];
    }
  }
  if (address) {
    const a = norm(address);
    for (const [key, pin] of PIN_INDEX) {
      if (a.includes(key)) return pin;
    }
    for (const [, pin] of PIN_INDEX) {
      const pinAddr = norm(pin.address);
      const aTokens = a.split(" ").filter((t) => t.length >= 4);
      if (aTokens.length >= 2 && aTokens.every((t) => pinAddr.includes(t))) return pin;
    }
  }
  return null;
}

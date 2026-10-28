/* Canonical approved league/selection rules from 2e9726f887d307909e62f56f06b3d1808ad04b91. */
(()=>{
const LEAGUES = Object.freeze({
    'EUR-Champions-League': 'EUR-CHL', 'EUR-Champions League': 'EUR-CHL',
    'EUR-Europa-League': 'EUR-EUL', 'EUR-Europa League': 'EUR-EUL',
    'ENG-Championship': 'ENG-CHA', 'ITA-Serie A': 'ITA-SRA', 'ENG-Premier League': 'ENG-PRE'
});

globalThis.MoneyTipsShadowRules=Object.freeze({leagues:LEAGUES,systems:Object.freeze({
  "MT - CHA EUR - V1.0": {
    "allowedLeagues": [
      "EUR-CHL",
      "EUR-EUL"
    ],
    "market": "Ambos equipos marcan",
    "selections": {
      "No": "No"
    }
  },
  "MT - ENG2 - v1.0": {
    "allowedLeagues": [
      "ENG-CHA"
    ],
    "market": "Resultado final",
    "selections": {
      "2": "Visitante",
      "Team 2 (FT)": "Visitante",
      "Away": "Visitante"
    }
  },
  "MT - ITA1 - V1.0": {
    "allowedLeagues": [
      "ITA-SRA"
    ],
    "market": "Ambos equipos marcan",
    "selections": {
      "No": "No"
    }
  },
  "MT - Premier League 02.5": {
    "allowedLeagues": [
      "ENG-PRE"
    ],
    "market": "Total de goles",
    "selections": {
      "Under 3.5": "Menos de 3,5 goles",
      "U 3.5 FT": "Menos de 3,5 goles"
    }
  }
})});
})();

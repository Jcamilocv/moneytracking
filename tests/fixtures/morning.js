export const NOW = new Date('2026-10-11T08:00:15Z');
export const item = (n = 1, overrides = {}) => ({
    MatchId: n, SystemId: 11, SystemName: 'MT - ITA1 - V1.0',
    DateOfMatch: '2026-10-11T13:00:00',
    HomeTeam: { TeamName: `Fixture ${n}` }, AwayTeam: { TeamName: 'Visitor' },
    League: { ShortName: 'ITA-SRA' },
    TargetMarket: { MarketCategory: 'Both Teams To Score', MarketName: 'No', Odds: 2.2, InOddsRanges: true },
    ...overrides
});
export const sourceResponse = (items, extra = {}) => new Response(JSON.stringify({
    ResultsPicksViewModelItems: items, ActivePicksCount: 108, ...extra
}), { status: 200, headers: { 'Content-Type': 'application/json' } });
export const sourceClientOptions = { baseUrl: 'https://application.futbolbrain.com/',
    sessionProvider: async () => ({ headers: { Cookie: 'SYNTHETIC_TEST_ONLY' } }), clock: () => NOW };
export const responseCapture = () => {
    const response = { headers: {}, statusCode: 200 };
    response.setHeader = (k, v) => { response.headers[k] = v; };
    response.status = code => { response.statusCode = code; return response; };
    response.json = body => { response.body = body; return response; };
    return response;
};

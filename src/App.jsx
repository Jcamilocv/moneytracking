import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
    LayoutDashboard, List, Settings, Plus, TrendingUp, Wallet, Menu, X, 
    ChevronDown, ChevronUp, Trash2, Edit2, CheckCircle2, Crown,
    Clock, Calendar, Download, Upload, FileText, 
    ArrowUpRight, ArrowDownRight, AlertTriangle, 
    BarChart2, LineChart, Tags, LogOut, Database, Eye, Link as LinkIcon, CalendarDays,
    HelpCircle, Lock, ShieldCheck, XCircle, AlertCircle
} from 'lucide-react';
import { 
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
    BarChart, Bar, Cell, Line, LineChart as ReLineChart 
} from 'recharts';
import LZString from 'lz-string';

// --- IA IMPORTS ---
import { GoogleGenerativeAI } from "@google/generative-ai";

// --- FIREBASE IMPORTS ---
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";
import { getFirestore, collection, onSnapshot, addDoc, doc, deleteDoc, updateDoc } from "firebase/firestore";

// --- CONFIGURACIÓN DE FIREBASE (Tus llaves) ---
const firebaseConfig = {
    apiKey: "AIzaSyDdhFhK2leqXczuBU-inLBLi9PfMt7NbkY",
    authDomain: "money-tracking-d908b.firebaseapp.com",
    projectId: "money-tracking-d908b",
    storageBucket: "money-tracking-d908b.firebasestorage.app",
    messagingSenderId: "776084225241",
    appId: "1:776084225241:web:f50c611da487a29a2112c8"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- ESTILOS GLOBALES ---
const globalStyles = `
    body { background-color: #0B1120; color: white; margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; }
    .custom-scrollbar::-webkit-scrollbar { width: 8px; height: 8px; }
    .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
    .custom-scrollbar::-webkit-scrollbar-thumb { background-color: #334155; border-radius: 10px; }
    .custom-scrollbar::-webkit-scrollbar-thumb:hover { background-color: #475569; }
    .animate-in { animation: fadeIn 0.3s ease-out; }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    .slide-in { animation: slideIn 0.3s ease-out; }
    @keyframes slideIn { from { transform: translateX(-100%); } to { transform: translateX(0); } }
`;

const LIMITS = { MAX_BANKS: 5, MAX_BETS_PER_BANK: 5000 };

// --- UTILIDADES ---
const formatCurrency = (value, currency = 'EUR') => {
    const val = typeof value === 'number' ? value : parseFloat(value) || 0;
    if (isNaN(val)) return '0,00 ' + (currency === 'EUR' ? '€' : currency);
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency: currency }).format(val);
};

const formatUnits = (value) => {
    const val = typeof value === 'number' ? value : parseFloat(value) || 0;
    return val.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' u';
};

const formatDate = (dateString) => {
    if (!dateString) return '-';
    try { const date = new Date(dateString); return new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit' }).format(date); } 
    catch (e) { return '-'; }
};

const COMMON_BOOKMAKERS = ["Bet365", "William Hill", "Betfair", "Bwin", "888sport", "Betway", "Marathonbet", "Sportium", "Codere", "Kirolbet", "Retabet", "Luckia", "Paf", "LeoVegas", "TonyBet", "Pinnacle", "1xBet", "Winamax", "Coolbet"].sort();

const parseComplexCSV = (text) => {
    const rows = []; let currentRow = []; let currentVal = ''; let insideQuotes = false;
    const cleanText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    for (let i = 0; i < cleanText.length; i++) {
        const char = cleanText[i]; const nextChar = cleanText[i + 1];
        if (char === '"') { if (insideQuotes && nextChar === '"') { currentVal += '"'; i++; } else { insideQuotes = !insideQuotes; } } 
        else if (char === ';' && !insideQuotes) { currentRow.push(currentVal); currentVal = ''; } 
        else if (char === '\n' && !insideQuotes) { currentRow.push(currentVal); rows.push(currentRow); currentRow = []; currentVal = ''; } 
        else { currentVal += char; }
    }
    if (currentRow.length > 0 || currentVal.length > 0) { currentRow.push(currentVal); rows.push(currentRow); }
    return rows;
};

// --- COMPONENTES UI ---
const StatCard = ({ title, value, subValue, isCurrency = false, currency = 'EUR', colorClass = "text-white" }) => (
    <div className="p-3 md:p-4 bg-slate-800/50 border border-slate-700/50 rounded-xl hover:bg-slate-800 transition-colors flex flex-col justify-between min-h-[90px]">
        <p className="text-slate-400 text-[10px] uppercase tracking-wider font-semibold mb-1 truncate" title={title}>{title}</p>
        <div className="flex-1 flex flex-col justify-end">
            <h3 className={`text-lg md:text-xl font-bold ${colorClass} truncate`}>{isCurrency ? formatCurrency(value, currency) : value}</h3>
            {subValue && <p className="text-[10px] text-slate-500 mt-0.5 truncate">{String(subValue)}</p>}
        </div>
    </div>
);

const StatusBadge = ({ status }) => {
    const styles = {
        won: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', lost: 'bg-red-500/10 text-red-400 border-red-500/20',
        pending: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20', void: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
        'half-won': 'bg-teal-500/10 text-teal-400 border-teal-500/20', 'half-lost': 'bg-orange-500/10 text-orange-400 border-orange-500/20',
    };
    const labels = { won: 'Ganada', lost: 'Perdida', pending: 'Pendiente', void: 'Nula', 'half-won': 'Mitad Ganada', 'half-lost': 'Mitad Perdida' };
    return <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide border ${styles[status] || styles.pending}`}>{labels[status] || status}</span>;
};

// --- APP PRINCIPAL ---
export default function App() {
    const [currentUser, setCurrentUser] = useState(null);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isRegistering, setIsRegistering] = useState(false);
    const [authError, setAuthError] = useState('');
    
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('dashboard');
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    
    const [banks, setBanks] = useState([]);
    const [currentBankId, setCurrentBankId] = useState(null);
    const [bets, setBets] = useState([]); 
    const [customOptions, setCustomOptions] = useState({ sports: [], categories: [] });
    
    const [showBetForm, setShowBetForm] = useState(false);
    const [isAddingBank, setIsAddingBank] = useState(false); 
    const [userRole, setUserRole] = useState('user');
    const [editingBetId, setEditingBetId] = useState(null); 
    const [expandedBetId, setExpandedBetId] = useState(null); 
    const [showMoreOptions, setShowMoreOptions] = useState(false);
    const [statusModalData, setStatusModalData] = useState(null); 
    const [expandedMonths, setExpandedMonths] = useState({});
    const [formErrors, setFormErrors] = useState({}); 
    const [isCustomBookmaker, setIsCustomBookmaker] = useState(false);
    const [chartViewMode, setChartViewMode] = useState('detailed');
    const [barChartViewMode, setBarChartViewMode] = useState('weekly'); 

    const [viewMode, setViewMode] = useState('personal'); 
    const [visitingBank, setVisitingBank] = useState(null);
    const [visitingBets, setVisitingBets] = useState([]);

    const [newCustomSport, setNewCustomSport] = useState('');
    const [newCustomCategory, setNewCustomCategory] = useState('');
    const [newBankData, setNewBankData] = useState({ name: '', initialCapital: 1000, currency: 'EUR' }); 
    const fileInputRef = useRef(null);
    
    const [isScanning, setIsScanning] = useState(false); // Estado para la IA

    const [newBet, setNewBet] = useState({
        date: new Date().toISOString().split('T')[0], time: '00:00', bookmaker: 'Bet365', betMode: 'simple', title: '', 
        selections: [{ id: Date.now(), title: '', selection: '', sport: 'Fútbol', status: 'pending', category: '', odds: 1.50, isOpen: true }],
        amount: 0, stake: 0, analysis: '', commission: '', bonus: '', isLive: false, isFreebet: false, cashout: '', isEachWay: false, tipster: 'Money Tips'
    });

    // --- INTEGRACIÓN DE IA GEMINI ---
    const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY);

    const escanearBoleto = async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        setIsScanning(true);
        try {
            const reader = new FileReader();
            reader.onloadend = async () => {
                const base64Data = reader.result.split(',')[1];
                
                const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
                const prompt = `Analiza esta captura de pantalla de un boleto de apuestas deportivas. Extrae la siguiente información y devuélvela ÚNICAMENTE en formato JSON válido, sin texto adicional y sin formato markdown (no uses \`\`\`json):
                {
                  "equipo": "Nombre del equipo o selección principal",
                  "cuota": "Número decimal de la cuota (ejemplo: 1.85)",
                  "mercado": "Tipo de apuesta (ejemplo: Ganador del partido, Más de 2.5 goles)",
                  "importe": "Cantidad apostada en números (ejemplo: 10.50)"
                }`;

                const imagePart = {
                    inlineData: { data: base64Data, mimeType: file.type }
                };

                const result = await model.generateContent([prompt, imagePart]);
                const responseText = result.response.text();
                
                const datosExtraidos = JSON.parse(responseText);
                console.log("Datos extraídos:", datosExtraidos);

                // Auto-calcular el stake basado en el importe extraído y el capital inicial
                const parsedAmount = parseFloat(datosExtraidos.importe);
                let calculatedStake = newBet.stake;
                let finalAmount = newBet.amount;
                
                if (!isNaN(parsedAmount) && parsedAmount > 0) {
                    finalAmount = parsedAmount;
                    const cap = parseFloat(activeBankData?.initialCapital || 1000);
                    calculatedStake = ((parsedAmount / cap) * 100).toFixed(2);
                }

                setNewBet(prev => ({
                    ...prev,
                    amount: finalAmount,
                    stake: calculatedStake,
                    selections: [
                        {
                            ...prev.selections[0],
                            title: datosExtraidos.equipo || prev.selections[0].title,
                            selection: datosExtraidos.mercado || prev.selections[0].selection,
                            odds: parseFloat(datosExtraidos.cuota) || prev.selections[0].odds
                        },
                        ...prev.selections.slice(1)
                    ]
                }));
                
                setIsScanning(false);
                alert("✅ ¡Boleto analizado! Revisa los datos auto-rellenados.");
            };
            
            reader.readAsDataURL(file);

        } catch (error) {
            console.error("Error al leer el boleto:", error);
            setIsScanning(false);
            alert("Hubo un error analizando la imagen. Comprueba que sea legible.");
        }
    };

    // 1. Escuchar el estado de autenticación
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            setCurrentUser(user);
            if (!user) { setLoading(false); setBanks([]); setBets([]); }
        });
        
        // Comprobar si hay un link compartido
        const params = new URLSearchParams(window.location.search);
        const shareData = params.get('share');
        if (shareData) {
            try {
                const decompressed = LZString.decompressFromEncodedURIComponent(shareData);
                if (decompressed) {
                    const parsed = JSON.parse(decompressed);
                    setVisitingBank(parsed.bank);
                    setVisitingBets(parsed.bets);
                    setViewMode('visiting');
                }
            } catch (e) { console.error("Error compartidos", e); }
        }
        
        return () => unsubscribe();
    }, []);

    // 2. Cargar datos de Firestore cuando hay usuario
    useEffect(() => {
        if (!currentUser || viewMode === 'visiting') return;

        setLoading(true);
        const banksRef = collection(db, 'users', currentUser.uid, 'banks');
        const unsubBanks = onSnapshot(banksRef, (snapshot) => {
            const banksData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setBanks(banksData);
            if (banksData.length > 0 && !currentBankId) setCurrentBankId(banksData[0].id);
        }, (error) => console.error(error));

        const betsRef = collection(db, 'users', currentUser.uid, 'bets');
        const unsubBets = onSnapshot(betsRef, (snapshot) => {
            const betsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setBets(betsData);
            setLoading(false);
        }, (error) => { console.error(error); setLoading(false); });

        // TODO: Migrar customOptions a Firebase si se desea en el futuro
        setCustomOptions({ sports: [], categories: [] });

        return () => { unsubBanks(); unsubBets(); };
    }, [currentUser, viewMode]);

    const activeBankData = useMemo(() => {
        if (viewMode === 'visiting' && visitingBank) return visitingBank;
        return banks.find(b => b.id === currentBankId) || null; 
    }, [banks, currentBankId, viewMode, visitingBank]);

    const activeBetsData = useMemo(() => {
        if (viewMode === 'visiting') return visitingBets;
        if (!currentBankId) return [];
        return bets.filter(b => b.bankId === currentBankId).sort((a, b) => new Date(`${b.date}T${b.time || '00:00'}`) - new Date(`${a.date}T${a.time || '00:00'}`));
    }, [bets, currentBankId, viewMode, visitingBets]);

    const currentBets = activeBetsData;

    const currencySymbol = useMemo(() => { 
        if (!activeBankData || !activeBankData.currency) return '€';
        const map = { 'EUR': '€', 'USD': '$', 'GBP': '£' }; 
        return map[activeBankData.currency] || '€'; 
    }, [activeBankData]);

    const betsByMonth = useMemo(() => {
        const groups = {};
        [...activeBetsData].forEach(bet => {
            const date = new Date(bet.date);
            const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            if (!groups[key]) {
                const mName = date.toLocaleString('es-ES', { month: 'long', year: 'numeric' });
                groups[key] = { id: key, label: mName.charAt(0).toUpperCase() + mName.slice(1), bets: [], profit: 0 };
            }
            groups[key].bets.push(bet); 
            const amt = bet.amount || 0; let pl = 0;
            if (bet.status === 'won') pl = (amt * bet.odds) - amt;
            else if (bet.status === 'lost') pl = -amt;
            else if (bet.status === 'half-won') pl = (amt/2)*(bet.odds-1);
            else if (bet.status === 'half-lost') pl = -(amt/2);
            groups[key].profit += pl;
        });
        return Object.values(groups).sort((a, b) => b.id.localeCompare(a.id)); 
    }, [activeBetsData]);

    useEffect(() => {
        if (betsByMonth.length > 0 && Object.keys(expandedMonths).length === 0) setExpandedMonths({ [betsByMonth[0].id]: true });
    }, [betsByMonth.length]);

    const toggleMonth = (id) => setExpandedMonths(p => ({ ...p, [id]: !p[id] }));

    const stats = useMemo(() => {
        if (!activeBankData) return { picks: 0, won: 0, lost: 0, staked: 0, returned: 0, profitDay: 0, profitFactor: 0, winRate: 0, profitPerPick: 0, yield: 0, totalProfit: 0, currentBankroll: 0, stakedUnits: 0, profitUnits: 0, detailedChart: [], weeklyChart: [], weeklyBarChart: [], monthlyBarChart: [] };

        const initialCapital = parseFloat(activeBankData.initialCapital) || 0;
        let staked=0, returned=0, won=0, lost=0, runningProfit=0;
        const profitHistory = []; const weeklyNetProfit = {}; const monthlyNetProfit = {};

        const getWeekKey = (dStr) => { try { const d=new Date(dStr); d.setHours(0,0,0,0); d.setDate(d.getDate()+4-(d.getDay()||7)); const yStart=new Date(d.getFullYear(),0,1); return `${d.getFullYear()}-W${String(Math.ceil((((d-yStart)/86400000)+1)/7)).padStart(2,'0')}`; } catch{return 'Unknown'} };

        [...activeBetsData].sort((a,b)=> new Date(`${a.date}T${a.time || '00:00'}`) - new Date(`${b.date}T${b.time || '00:00'}`)).forEach((bet, idx) => {
            if(bet.status === 'pending') return;
            const amt = bet.amount || 0; staked += amt; let profit = 0;
            if (bet.status === 'won') { won++; profit = (amt * bet.odds) - amt; returned += (amt * bet.odds); } 
            else if (bet.status === 'lost') { lost++; profit = -amt; }
            else if (bet.status === 'half-won') { won+=0.5; profit = (amt/2)*(bet.odds-1); returned += (amt + profit); }
            else if (bet.status === 'half-lost') { lost+=0.5; profit = -(amt/2); returned += (amt/2); }
            
            runningProfit += profit;
            profitHistory.push({ name: idx+1, profit: runningProfit, date: bet.date, fullLabel: `Apuesta ${idx+1}` });
            
            const wk = getWeekKey(bet.date);
            if (wk !== 'Unknown') weeklyNetProfit[wk] = (weeklyNetProfit[wk] || 0) + profit;
            const mKey = bet.date.substring(0, 7); 
            monthlyNetProfit[mKey] = (monthlyNetProfit[mKey] || 0) + profit;
        });

        const weeklyChartData = Object.keys(weeklyNetProfit).sort().map(k => ({ name: k.split('-W')[1], profit: weeklyNetProfit[k], fullLabel: `Semana ${k}` }));
        const monthlyChartData = Object.keys(monthlyNetProfit).sort().map(k => {
            const [y, m] = k.split('-'); const date = new Date(y, m - 1);
            return { name: date.toLocaleString('es-ES', { month: 'short' }).toUpperCase(), profit: monthlyNetProfit[k], fullLabel: `${date.toLocaleString('es-ES', { month: 'long', year: 'numeric' })}` };
        });

        let wkAcc = 0;
        const weeklyLineData = weeklyChartData.map(d => { wkAcc += d.profit; return { ...d, profit: wkAcc }; });
        const profitFactor = Math.abs(runningProfit) > 0 && staked > 0 ? (returned / staked) : 0;
        const days = activeBetsData.length > 0 ? Math.max(1, (new Date() - new Date(activeBetsData[activeBetsData.length-1].date)) / (1000 * 60 * 60 * 24)) : 1;
        
        return {
            picks: activeBetsData.length, won, lost, staked, returned, profitDay: runningProfit / days, profitFactor: (staked-runningProfit) > 0 ? (returned/(staked-runningProfit)) : 0,
            winRate: (won + lost) > 0 ? (won / (won + lost)) * 100 : 0, profitPerPick: (won+lost)>0 ? runningProfit/(won+lost) : 0, yield: staked > 0 ? (runningProfit / staked) * 100 : 0,
            totalProfit: runningProfit, currentBankroll: initialCapital + runningProfit,
            stakedUnits: staked / (initialCapital > 0 ? initialCapital * 0.01 : 1), profitUnits: runningProfit / (initialCapital > 0 ? initialCapital * 0.01 : 1),
            detailedChart: profitHistory.length ? profitHistory : [{name:'Inicio', profit:0}], weeklyChart: weeklyLineData.length ? weeklyLineData : [{name:'Inicio', profit:0}], 
            weeklyBarChart: weeklyChartData, monthlyBarChart: monthlyChartData
        };
    }, [activeBetsData, activeBankData]);

    const handleAuth = async (e) => {
        e.preventDefault();
        setAuthError('');
        if(!email.trim() || !password.trim()) { setAuthError('Rellena todos los campos.'); return; }
        
        try {
            if (isRegistering) {
                await createUserWithEmailAndPassword(auth, email, password);
            } else {
                await signInWithEmailAndPassword(auth, email, password);
            }
        } catch (error) {
            console.error(error);
            if (error.code === 'auth/email-already-in-use') setAuthError('Este email ya está registrado.');
            else if (error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') setAuthError('Email o contraseña incorrectos.');
            else setAuthError('Error de autenticación. Revisa tus datos.');
        }
    };

    const handleLogout = async () => {
        await signOut(auth);
        if(viewMode === 'visiting') {
            try { window.history.pushState({}, document.title, window.location.pathname); } catch(e) {}
            setViewMode('personal'); setVisitingBank(null); setVisitingBets([]);
        }
    };

    const generateShareLink = () => {
        if(!activeBankData || !activeBankData.id) return alert("Selecciona una banca válida.");
        const publicBets = activeBetsData.filter(bet => bet.status !== 'pending');
        const shareObj = { bank: activeBankData, bets: publicBets };
        try {
            const compressed = LZString.compressToEncodedURIComponent(JSON.stringify(shareObj));
            const url = `${window.location.origin}${window.location.pathname}?share=${compressed}`;
            const el = document.createElement('textarea'); el.value = url; document.body.appendChild(el); el.select(); document.execCommand('copy'); document.body.removeChild(el);
            alert("✅ ¡Enlace copiado al portapapeles!\n\nNota: Se han excluido tus apuestas 'Pendientes' por privacidad. Los visitantes solo verán tu historial resuelto.");
        } catch (e) { alert("Error generando el enlace (Demasiados datos)."); }
    };

    const handleExitVisiting = () => {
        setViewMode('personal'); setVisitingBank(null); setVisitingBets([]);
        try { window.history.pushState({}, document.title, window.location.pathname); } catch(e) {}
    };

    const handleAmountChange = (val, type) => {
        const num = parseFloat(val) || 0; const cap = parseFloat(activeBankData?.initialCapital || 1000);
        if (type === 'amount') setNewBet(prev => ({ ...prev, amount: num, stake: ((num/cap)*100).toFixed(2) }));
        else setNewBet(prev => ({ ...prev, stake: num, amount: ((num/100)*cap).toFixed(2) }));
    };

    const handleSaveBet = async (e) => {
        e.preventDefault(); if (viewMode === 'visiting') return; 
        if (!newBet.amount) return alert("Introduce importe"); if (!currentBankId) return alert("Crea una banca primero.");
        if (!editingBetId && currentBets.length >= LIMITS.MAX_BETS_PER_BANK) { return alert(`Límite de ${LIMITS.MAX_BETS_PER_BANK} apuestas por banca alcanzado.`); }
        
        const totalOdds = newBet.selections.reduce((acc, s) => acc * (parseFloat(s.odds)||1), 1);
        const betData = { ...newBet, odds: parseFloat(totalOdds.toFixed(2)), amount: parseFloat(newBet.amount), bankId: currentBankId, createdAt: new Date().toISOString() };
        
        try {
            if (editingBetId) {
                await updateDoc(doc(db, 'users', currentUser.uid, 'bets', editingBetId), betData);
            } else {
                await addDoc(collection(db, 'users', currentUser.uid, 'bets'), betData);
            }
            setShowBetForm(false); setEditingBetId(null); setIsCustomBookmaker(false);
            setNewBet({ date: new Date().toISOString().split('T')[0], time: '00:00', bookmaker: 'Bet365', betMode: 'simple', title: '', selections: [{ id: Date.now(), title: '', selection: '', sport: 'Fútbol', status: 'pending', category: '', odds: 1.50, isOpen: true }], amount: 0, stake: 0, analysis: '' });
        } catch (error) {
            console.error("Error guardando apuesta:", error);
            alert("Error guardando apuesta.");
        }
    };

    const handleImportCSV = async (event) => {
        if (viewMode === 'visiting') return alert("No puedes importar datos.");
        const file = event.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            const allRows = parseComplexCSV(e.target.result);
            const dataRows = (allRows.length > 0 && allRows[0][0] && allRows[0][0].replace(/"/g, '') === 'Date') ? allRows.slice(1) : allRows;
            if (dataRows.length === 0) return alert("Archivo vacío.");
            const validNewRows = dataRows.filter(cols => cols && cols.length >= 2 && cols[0]);
            let newBets = []; let currentBet = null;
            validNewRows.forEach(cols => {
                const cleanCols = cols.map(c => c ? c.replace(/^"|"$/g, '').trim() : ''); const dateVal = cleanCols[0]; const statusMap = { 'W': 'won', 'L': 'lost', 'V': 'void', 'P': 'pending' };
                if (dateVal) {
                    if (currentBet) newBets.push(currentBet);
                    const [d, t] = dateVal.split(' '); const amountVal = parseFloat(cleanCols[5]) || 0; const stakeVal = ((amountVal / parseFloat(activeBankData?.initialCapital || 1000)) * 100).toFixed(2);
                    currentBet = { date: d || new Date().toISOString().split('T')[0], time: t || '00:00', bookmaker: cleanCols[7] || '', category: cleanCols[9] || 'General', odds: parseFloat(cleanCols[4]) || 1.0, amount: amountVal, stake: stakeVal, status: statusMap[cleanCols[6]] || 'pending', title: cleanCols[3], selection: cleanCols[11] || 'Multiple', analysis: cleanCols[19], bankId: currentBankId, createdAt: new Date().toISOString(), imported: true, selections: [] };
                    if (cleanCols[1] === 'Simple' || cleanCols[2] !== '') currentBet.selections.push({ id: Date.now() + Math.random(), title: cleanCols[3], selection: cleanCols[11], odds: parseFloat(cleanCols[4]), sport: cleanCols[2], category: cleanCols[9], status: statusMap[cleanCols[6]] || 'pending', isOpen: false });
                } else if (currentBet) currentBet.selections.push({ id: Date.now() + Math.random(), title: cleanCols[3], selection: cleanCols[11], odds: parseFloat(cleanCols[4]), sport: cleanCols[2], category: cleanCols[9], status: statusMap[cleanCols[6]] || 'pending', isOpen: false });
            });
            if (currentBet) newBets.push(currentBet);
            
            try {
                for(let b of newBets) { await addDoc(collection(db, 'users', currentUser.uid, 'bets'), b); }
                alert(`¡Importado con éxito! Añadidas ${newBets.length} apuestas.`);
            } catch(error) {
                console.error(error); alert("Error importando algunos datos.");
            }
        };
        reader.readAsText(file); event.target.value = null;
    };

    const handleExportCSV = () => {
        if (!activeBetsData.length) return alert("No hay datos en esta banca.");
        const header = `"Date";"Type";"Sport";"Label";"Odds";"Stake";"State";"Bookmaker";"Tipster";"Category";"Competition";"BetType";"Closing";"Commission";"Bonus";"Live";"Freebet";"Cashout";"Eachway";"Comment"`;
        const rows = activeBetsData.map(b => {
            const statusMap = { 'won': 'W', 'lost': 'L', 'void': 'V', 'pending': 'P', 'half-won': 'HW', 'half-lost': 'HL' }; const dateFull = `${b.date} ${b.time || '00:00'}`; const safeText = (txt) => txt ? txt.replace(/"/g, '""') : '';
            return `"${dateFull}";"${b.selections?.length > 1 ? 'Combined' : 'Simple'}";"${safeText(b.selections[0]?.sport)}";"${safeText(b.title)}";"${b.odds}";"${b.amount || 0}";"${statusMap[b.status] || 'P'}";"${safeText(b.bookmaker)}";"";"${safeText(b.selections[0]?.category)}";"";"${safeText(b.selection)}";"";"";"";"${b.isLive ? 'Yes' : 'No'}";"${b.isFreebet ? 'Yes' : 'No'}";"${b.cashout || ''}";"${b.isEachWay ? 'Yes' : 'No'}";"${safeText(b.analysis)}"`
        });
        const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([[header, ...rows].join("\n")], { type: 'text/csv;charset=utf-8;' })); link.setAttribute("download", `MoneyTracKING_Export_${new Date().toISOString().slice(0,10)}.csv`); document.body.appendChild(link); link.click(); document.body.removeChild(link);
    };

    const handleDeleteBet = async (id) => { 
        if (viewMode === 'visiting') return;
        if(confirm('¿Eliminar esta apuesta?')) {
            try { await deleteDoc(doc(db, 'users', currentUser.uid, 'bets', id)); }
            catch(e) { console.error(e); }
        }
    };

    const handleQuickStatusChange = async (status) => { 
        if (viewMode === 'visiting' || !statusModalData) return;
        try {
            const betToUpdate = bets.find(b => b.id === statusModalData.id);
            if(betToUpdate) {
                const newSels = betToUpdate.selections.map(s => ({...s, status}));
                await updateDoc(doc(db, 'users', currentUser.uid, 'bets', statusModalData.id), { status, selections: newSels });
            }
            setStatusModalData(null); 
        } catch(e) { console.error(e); }
    };

    const handleBookieChange = (e) => { const val=e.target.value; if(val==='Otra'){setIsCustomBookmaker(true);setNewBet(p=>({...p,bookmaker:''}))}else{setIsCustomBookmaker(false);setNewBet(p=>({...p,bookmaker:val}))}};
    const handleEditClick = (bet) => { if (viewMode === 'visiting') return; setIsCustomBookmaker(!COMMON_BOOKMAKERS.includes(bet.bookmaker)); setEditingBetId(bet.id); setFormErrors({}); setNewBet(bet); setShowBetForm(true); };
    const handleAddSelection = () => setNewBet(p => ({...p, selections: [...p.selections, { id: Date.now(), title: '', selection: '', sport: 'Fútbol', status: 'pending', category: '', odds: 1.50, isOpen: true }]}));
    const handleRemoveSelection = (id) => { if(newBet.selections.length > 1) setNewBet(p => ({ ...p, selections: p.selections.filter(s => s.id !== id) })); };
    const handleUpdateSelection = (id, f, v) => setNewBet(p => ({ ...p, selections: p.selections.map(s => s.id === id ? { ...s, [f]: v } : s) }));
    const toggleSelection = (id) => setNewBet(p => ({ ...p, selections: p.selections.map(s => s.id === id ? { ...s, isOpen: !s.isOpen } : s) }));

    const handleAddOption = (type, value) => { /* TODO: Mover custom Options a DB */ };
    const handleDeleteOption = (type, value) => { /* TODO: Mover custom Options a DB */ };
    
    const openAddBankModal = () => {
        if(banks.length >= LIMITS.MAX_BANKS) return alert(`Límite de ${LIMITS.MAX_BANKS} bancas alcanzado.`);
        setNewBankData({ name: `Nueva Banca ${banks.length+1}`, initialCapital: 1000, currency: 'EUR' }); setIsAddingBank(true);
    };

    const confirmAddBank = async (e) => {
        e.preventDefault();
        const newBank = { name: newBankData.name || `Nueva Banca ${banks.length+1}`, initialCapital: parseFloat(newBankData.initialCapital) || 1000, currency: newBankData.currency, createdAt: new Date().toISOString(), isEditable: false };
        try { await addDoc(collection(db, 'users', currentUser.uid, 'banks'), newBank); setIsAddingBank(false); }
        catch(error) { console.error(error); alert("Error creando banca."); }
    };

    const handleUpdateBank = async (id, field, value) => {
        if(field === 'initialCapital') return; 
        try { await updateDoc(doc(db, 'users', currentUser.uid, 'banks', id), { [field]: value }); }
        catch(e) { console.error(e); }
    }

    const handleDeleteBank = async (id) => {
        if(confirm('¿Borrar banca? Se borrarán sus datos asociados.')) {
            try { await deleteDoc(doc(db, 'users', currentUser.uid, 'banks', id)); }
            catch(e) { console.error(e); }
        }
    };

    const MobileMenuItem = ({ icon: Icon, label, tabId }) => (
        <button onClick={() => { setActiveTab(tabId); setIsMobileMenuOpen(false); }} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${activeTab === tabId ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'text-slate-400 hover:bg-slate-800/50 hover:text-white'}`}><Icon size={18}/> {label}</button>
    );

    if (!currentUser) {
        return (
            <><style>{globalStyles}</style>
            <div className="min-h-screen bg-[#0B1120] flex items-center justify-center p-4 text-white">
                <div className="bg-[#0F1629] p-8 rounded-2xl border border-slate-700/50 shadow-2xl w-full max-w-md animate-in fade-in">
                    <div className="flex justify-center mb-6"><div className="w-16 h-16 bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-2xl flex items-center justify-center shadow-lg"><TrendingUp size={32} className="text-white"/></div></div>
                    <h1 className="text-2xl font-bold text-center text-white mb-2">MoneyTrac<span className="text-yellow-400">KING</span></h1>
                    <p className="text-slate-400 text-center text-sm mb-6">Tu gestor de bankroll en la nube</p>
                    <form onSubmit={handleAuth} className="space-y-4">
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Email</label>
                            <input type="email" placeholder="tu@email.com" className="w-full bg-[#1A2035] border border-slate-700 rounded-xl px-4 py-3 text-white focus:border-emerald-500 outline-none transition-colors" value={email} onChange={e => setEmail(e.target.value)} autoFocus required />
                        </div>
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Contraseña</label>
                            <input type="password" placeholder="••••••••" className="w-full bg-[#1A2035] border border-slate-700 rounded-xl px-4 py-3 text-white focus:border-emerald-500 outline-none transition-colors" value={password} onChange={e => setPassword(e.target.value)} required />
                        </div>
                        {authError && <p className="text-red-400 text-xs text-center">{authError}</p>}
                        <button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-emerald-500/20">
                            {isRegistering ? 'Crear Cuenta' : 'Entrar'}
                        </button>
                    </form>
                    <p className="mt-6 text-center text-sm text-slate-400">
                        {isRegistering ? '¿Ya tienes cuenta?' : '¿No tienes cuenta?'} 
                        <button onClick={() => setIsRegistering(!isRegistering)} className="text-emerald-400 ml-2 hover:underline">{isRegistering ? 'Entra aquí' : 'Regístrate gratis'}</button>
                    </p>
                </div>
            </div></>
        );
    }

    if (loading && viewMode === 'personal') return <><style>{globalStyles}</style><div className="min-h-screen bg-[#0B1120] flex items-center justify-center text-emerald-500 animate-pulse font-bold text-xl">Conectando con la nube...</div></>;

    if (banks.length === 0 && viewMode === 'personal') {
        return (
            <><style>{globalStyles}</style>
            <div className="flex flex-col md:flex-row h-screen bg-[#0B1120] text-slate-100 font-sans overflow-hidden">
                <aside className="hidden md:flex flex-col w-64 bg-[#0F1629] border-r border-slate-800/50">
                    <div className="p-6 border-b border-slate-800/50 flex items-center gap-3"><div className="w-8 h-8 bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-lg flex items-center justify-center shadow-lg"><TrendingUp size={18} className="text-white"/></div><h1 className="font-bold text-lg tracking-tight">MoneyTrac<span className="text-yellow-400">KING</span></h1></div>
                    <div className="flex-1 p-4 flex flex-col justify-end"><div className="p-4 border-t border-slate-800/50"><div className="flex items-center justify-between mb-2"><div className="flex items-center gap-2"><div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center text-xs font-bold text-white">{currentUser.email?.charAt(0).toUpperCase()}</div><div className="text-sm font-medium text-white max-w-[100px] truncate">{currentUser.email?.split('@')[0]}</div></div><button onClick={handleLogout} className="text-slate-500 hover:text-red-400"><LogOut size={16}/></button></div></div></div>
                </aside>
                <main className="flex-1 flex flex-col items-center justify-center p-6 text-center">
                    <div className="bg-[#0F1629] p-8 rounded-2xl border border-slate-700/50 shadow-xl max-w-lg w-full">
                        <div className="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-6"><Plus size={32} className="text-emerald-500" /></div>
                        <h2 className="text-2xl font-bold text-white mb-2">¡Bienvenido a la nube!</h2>
                        <p className="text-slate-400 mb-8">Tus datos ahora están seguros. Crea tu primera banca para empezar.</p>
                        <button onClick={openAddBankModal} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-8 rounded-xl transition-all shadow-lg shadow-emerald-500/20 w-full flex items-center justify-center gap-2"><Plus size={20}/> Crear mi Primera Banca</button>
                    </div>
                </main>
                
                {isAddingBank && (
                    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
                        <div className="bg-[#0B1120] w-full max-w-sm rounded-2xl shadow-2xl border border-slate-800 overflow-hidden flex flex-col">
                            <div className="px-5 py-4 border-b border-slate-800 flex justify-between items-center bg-[#0F1629]"><h3 className="font-bold text-white text-lg">Nueva Banca</h3><button onClick={() => setIsAddingBank(false)} className="text-slate-400 hover:text-white"><X size={20}/></button></div>
                            <div className="p-6 space-y-4">
                                <div className="space-y-1"><label className="text-xs text-slate-500 uppercase font-bold tracking-wider">Nombre</label><input type="text" placeholder="Ej: Bet365 Principal" className="w-full bg-[#151b2e] border border-slate-700 rounded-lg px-3 py-2 text-white focus:border-emerald-500 outline-none transition-colors" value={newBankData.name} onChange={e => setNewBankData({...newBankData, name: e.target.value})} autoFocus /></div>
                                <div className="space-y-1"><label className="text-xs text-slate-500 uppercase font-bold tracking-wider flex items-center gap-2">Capital Inicial</label><input type="number" placeholder="1000" className="w-full bg-[#151b2e] border border-slate-700 rounded-lg px-3 py-2 text-white focus:border-emerald-500 outline-none transition-colors" value={newBankData.initialCapital} onChange={e => setNewBankData({...newBankData, initialCapital: e.target.value})} /></div>
                                <div className="space-y-1"><label className="text-xs text-slate-500 uppercase font-bold tracking-wider">Divisa</label><select className="w-full bg-[#151b2e] border border-slate-700 rounded-lg px-3 py-2 text-white focus:border-emerald-500 outline-none transition-colors" value={newBankData.currency} onChange={e => setNewBankData({...newBankData, currency: e.target.value})}><option value="EUR">EUR (€)</option><option value="USD">USD ($)</option><option value="GBP">GBP (£)</option><option value="MXN">MXN ($)</option></select></div>
                                <button onClick={confirmAddBank} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-lg transition-all shadow-lg shadow-emerald-500/20 mt-2">Crear Banca</button>
                            </div>
                        </div>
                    </div>
                )}
            </div></>
        );
    }

    return (
        <><style>{globalStyles}</style>
        <div className="flex flex-col md:flex-row h-screen bg-[#0B1120] text-slate-100 font-sans overflow-hidden">
            {isMobileMenuOpen && (
                <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm md:hidden animate-in fade-in" onClick={() => setIsMobileMenuOpen(false)}>
                    <div className="absolute top-0 left-0 bottom-0 w-64 bg-[#0F1629] p-4 shadow-2xl border-r border-slate-800 slide-in" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-6"><h2 className="font-bold text-lg text-white">Menú</h2><button onClick={() => setIsMobileMenuOpen(false)} className="p-1 rounded-full hover:bg-slate-800 text-slate-400"><X size={20}/></button></div>
                        <nav className="space-y-1"><MobileMenuItem icon={LayoutDashboard} label="Dashboard" tabId="dashboard" /><MobileMenuItem icon={List} label="Mis Apuestas" tabId="bets" /><div className="pt-6 pb-2 px-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Configuración</div><MobileMenuItem icon={Settings} label="Configuración" tabId="settings" /><MobileMenuItem icon={Tags} label="Personalización" tabId="customization" /></nav>
                    </div>
                </div>
            )}

            <aside className={`hidden md:flex flex-col w-64 bg-[#0F1629] border-r border-slate-800/50 transition-all`}>
                <div className="p-6 border-b border-slate-800/50 flex items-center gap-3"><div className="w-8 h-8 bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-lg flex items-center justify-center shadow-lg"><TrendingUp size={18} className="text-white"/></div><h1 className="font-bold text-lg tracking-tight">MoneyTrac<span className="text-yellow-400">KING</span></h1></div>
                {viewMode === 'visiting' ? (
                    <div className="flex-1 flex flex-col p-4 bg-indigo-900/10">
                        <div className="mb-4 p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl"><p className="text-[10px] text-indigo-300 uppercase font-bold mb-1 flex items-center gap-2"><Eye size={12}/> Modo Visitante</p><p className="text-white text-sm font-bold truncate">{visitingBank?.name}</p></div>
                        <nav className="space-y-1"><button onClick={() => setActiveTab('dashboard')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${activeTab === 'dashboard' ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' : 'text-slate-400 hover:bg-slate-800/50 hover:text-white'}`}><LayoutDashboard size={18}/> Dashboard</button><button onClick={() => setActiveTab('bets')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${activeTab === 'bets' ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' : 'text-slate-400 hover:bg-slate-800/50 hover:text-white'}`}><List size={18}/> Historial</button></nav>
                        <div className="mt-auto"><button onClick={handleExitVisiting} className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-bold text-white bg-slate-700 hover:bg-slate-600 transition-colors"><LogOut size={16}/> Volver a mi Banca</button></div>
                    </div>
                ) : (
                    <><nav className="p-4 space-y-1 flex-1"><button onClick={() => setActiveTab('dashboard')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${activeTab === 'dashboard' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'text-slate-400 hover:bg-slate-800/50 hover:text-white'}`}><LayoutDashboard size={18}/> Dashboard</button><button onClick={() => setActiveTab('bets')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${activeTab === 'bets' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'text-slate-400 hover:bg-slate-800/50 hover:text-white'}`}><List size={18}/> Mis Apuestas</button><div className="pt-6 pb-2 px-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Configuración</div><button onClick={() => setActiveTab('settings')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${activeTab === 'settings' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'text-slate-400 hover:bg-slate-800/50 hover:text-white'}`}><Settings size={18}/> Configuración</button><button onClick={() => setActiveTab('customization')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${activeTab === 'customization' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'text-slate-400 hover:bg-slate-800/50 hover:text-white'}`}><Tags size={18}/> Personalización</button></nav><div className="p-4 border-t border-slate-800/50"><div className="flex items-center justify-between mb-2"><div className="flex items-center gap-2"><div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center text-xs font-bold text-white">{currentUser.email?.charAt(0).toUpperCase()}</div><div className="text-sm font-medium text-white max-w-[100px] truncate">{currentUser.email?.split('@')[0]}</div></div><button onClick={handleLogout} className="text-slate-500 hover:text-red-400"><LogOut size={16}/></button></div><div className="text-center text-[10px] text-emerald-500"><ShieldCheck size={10} className="inline mr-1"/> Conectado a la nube</div></div></>
                )}
            </aside>

            <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-[#0B1120] relative mb-16 md:mb-0">
                <header className="h-16 bg-[#0F1629]/80 backdrop-blur border-b border-slate-800/50 flex items-center justify-between px-4 sticky top-0 z-30">
                    <div className="flex items-center gap-3">
                        <button onClick={() => setIsMobileMenuOpen(true)} className="md:hidden p-2 rounded-lg text-white hover:bg-slate-800"><Menu size={20} /></button>
                        <div className="md:hidden w-8 h-8 bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-lg flex items-center justify-center"><TrendingUp size={16} className="text-white"/></div>
                        <h2 className="text-lg font-bold text-white truncate">{viewMode === 'visiting' ? <span className="text-indigo-400 flex items-center gap-2"><Eye size={18}/> Visitando: {activeBankData?.name}</span> : (activeTab === 'dashboard' ? 'Panel de Control' : activeTab === 'bets' ? 'Mis Apuestas' : activeTab === 'customization' ? 'Personalización' : 'Configuración')}</h2>
                    </div>
                    {viewMode === 'personal' && activeBankData && (
                        <div className="relative"><div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><Wallet size={14} className="text-emerald-500"/></div><select value={currentBankId||''} onChange={(e)=>setCurrentBankId(e.target.value)} className="appearance-none bg-[#1A2035] border border-slate-700 text-white pl-9 pr-8 py-1.5 rounded-lg text-xs md:text-sm focus:outline-none focus:border-emerald-500 shadow-lg font-medium">{banks.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select><ChevronDown className="absolute right-2 top-2 text-slate-400 pointer-events-none" size={14}/></div>
                    )}
                     {viewMode === 'visiting' && (
                        <div className="bg-indigo-500/20 border border-indigo-500/30 px-3 py-1 rounded text-xs text-indigo-300 font-bold" title="Por privacidad, las apuestas pendientes están ocultas.">Modo Lectura (Picks ocultos)</div>
                    )}
                </header>

                <div className="flex-1 overflow-auto p-4 space-y-6 custom-scrollbar">
                {activeTab === 'dashboard' && activeBankData && (
                    <><div className="relative overflow-hidden bg-gradient-to-r from-emerald-600 to-teal-700 rounded-2xl p-6 md:p-8 shadow-2xl shadow-emerald-500/10">
                        <div className="relative z-10 flex justify-between items-start">
                            <div><h3 className="text-emerald-100 text-sm font-medium mb-1">Beneficio Total ({activeBankData?.name})</h3><h1 className="text-4xl md:text-5xl font-bold text-white tracking-tight">{formatCurrency(stats.totalProfit, activeBankData?.currency)}</h1></div>
                            {viewMode === 'personal' && (
                                <div className="flex gap-2">
                                    <button onClick={generateShareLink} className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg text-sm font-bold backdrop-blur-sm flex items-center gap-2 transition-colors border border-white/10"><LinkIcon size={16}/> Compartir Banca</button>
                                </div>
                            )}
                        </div>
                        <div className="absolute right-0 bottom-0 opacity-10 transform translate-y-1/4 translate-x-1/4"><Wallet size={160} /></div>
                    </div>
                    
                    <div className="bg-[#0F1629] border border-slate-800/50 rounded-2xl p-4 md:p-6"><div className="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4"><StatCard title="Picks" value={stats.picks} subValue="Total" /><StatCard title="Ganados" value={stats.won} colorClass="text-emerald-400" /><StatCard title="U. APOSTADAS" value={formatUnits(stats.stakedUnits)} /><StatCard title="Beneficio/Día" value={formatCurrency(stats.profitDay, activeBankData?.currency)} colorClass={stats.profitDay >= 0 ? "text-emerald-400" : "text-red-400"} /><StatCard title="Factor de Beneficio" value={stats.profitFactor.toFixed(2)} /><StatCard title="Tasa de Acierto" value={`${stats.winRate.toFixed(2)}%`} /><StatCard title="Perdidos" value={stats.lost} colorClass="text-red-400" /><StatCard title="U. GANADAS (NETO)" value={formatUnits(stats.profitUnits)} colorClass={stats.profitUnits >= 0 ? "text-emerald-400" : "text-red-400"} /><StatCard title="Beneficio/Pick" value={formatCurrency(stats.profitPerPick, activeBankData?.currency)} colorClass={stats.profitPerPick >= 0 ? "text-emerald-400" : "text-red-400"} /><StatCard title="Yield" value={`${stats.yield.toFixed(2)}%`} colorClass={stats.yield >= 0 ? "text-emerald-400" : "text-red-400"} /></div></div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4"><div className="bg-[#0F1629] border border-slate-800/50 rounded-2xl p-4 h-64 flex flex-col relative"><div className="flex justify-between items-center mb-4"><h4 className="text-xs text-slate-400 uppercase font-bold">Beneficio Acumulado</h4><div className="flex bg-[#1A2035] rounded-lg p-0.5"><button onClick={() => setChartViewMode('detailed')} className={`px-2 py-0.5 text-[10px] rounded ${chartViewMode==='detailed'?'bg-emerald-500 text-white':'text-slate-500'}`}><TrendingUp size={12}/></button><button onClick={() => setChartViewMode('weekly')} className={`px-2 py-0.5 text-[10px] rounded ${chartViewMode==='weekly'?'bg-emerald-500 text-white':'text-slate-500'}`}><LineChart size={12}/></button></div></div><ResponsiveContainer width="100%" height="100%">{chartViewMode === 'detailed' ? (<AreaChart data={stats.detailedChart}><defs><linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.2}/><stop offset="95%" stopColor="#10b981" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false}/><XAxis dataKey="name" stroke="#64748b" tick={{fontSize:10}} tickLine={false} axisLine={false}/><YAxis stroke="#64748b" tick={{fontSize:10}} tickLine={false} axisLine={false}/><Tooltip contentStyle={{backgroundColor:'#0f172a', border:'none', borderRadius:'8px'}} itemStyle={{color:'#10b981'}} formatter={(val)=>[formatCurrency(val,activeBankData?.currency), 'Beneficio']} /><Area type="monotone" dataKey="profit" stroke="#fbbf24" strokeWidth={2} fill="url(#colorProfit)"/></AreaChart>) : (<ReLineChart data={stats.weeklyChart}><CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false}/><XAxis dataKey="name" stroke="#64748b" tick={{fontSize:10}} tickLine={false} axisLine={false} label={{ value: 'Semanas', position: 'insideBottomRight', offset: -5, fill: '#64748b', fontSize: 10 }}/><YAxis stroke="#64748b" tick={{fontSize:10}} tickLine={false} axisLine={false}/><Tooltip contentStyle={{backgroundColor:'#0f172a', border:'none', borderRadius:'8px'}} itemStyle={{color:'#10b981'}} labelFormatter={(l, p) => p[0]?.payload?.fullLabel || l} formatter={(val)=>[formatCurrency(val,activeBankData?.currency), 'Beneficio']} /><Line type="linear" dataKey="profit" stroke="#fbbf24" strokeWidth={1} dot={{r: 3, fill: '#fbbf24', strokeWidth: 0}} activeDot={{r: 5, stroke: '#fff', strokeWidth: 1}}/></ReLineChart>)}</ResponsiveContainer></div><div className="bg-[#0F1629] border border-slate-800/50 rounded-2xl p-4 h-64 flex flex-col relative"><div className="flex justify-between items-center mb-4"><h4 className="text-xs text-slate-400 uppercase font-bold">Beneficio / {barChartViewMode === 'weekly' ? 'Semana' : 'Mes'}</h4><div className="flex bg-[#1A2035] rounded-lg p-0.5"><button onClick={() => setBarChartViewMode('weekly')} className={`px-2 py-0.5 text-[10px] rounded ${barChartViewMode==='weekly'?'bg-emerald-500 text-white':'text-slate-500'}`}><CalendarDays size={12} className="inline mr-1"/>Semana</button><button onClick={() => setBarChartViewMode('monthly')} className={`px-2 py-0.5 text-[10px] rounded ${barChartViewMode==='monthly'?'bg-emerald-500 text-white':'text-slate-500'}`}><Calendar size={12} className="inline mr-1"/>Mes</button></div></div><ResponsiveContainer width="100%" height="100%"><BarChart data={barChartViewMode === 'weekly' ? stats.weeklyBarChart : stats.monthlyBarChart}><CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false}/><XAxis dataKey="name" stroke="#64748b" tick={{fontSize:10}} tickLine={false} axisLine={false}/><YAxis stroke="#64748b" tick={{fontSize:10}} tickLine={false} axisLine={false}/><Tooltip contentStyle={{backgroundColor:'#0f172a', border:'none', borderRadius:'8px'}} cursor={{fill:'transparent'}} formatter={(val)=>[formatCurrency(val,activeBankData?.currency), 'Beneficio']}/><Bar dataKey="profit" radius={[4,4,0,0]}>{(barChartViewMode === 'weekly' ? stats.weeklyBarChart : stats.monthlyBarChart).map((e,i)=><Cell key={`c-${i}`} fill={e.profit>=0?'#10b981':'#ef4444'}/>)}</Bar></BarChart></ResponsiveContainer></div></div></>
                )}

                {activeTab === 'bets' && (
                    <div className="space-y-4">
                    <div className="flex justify-between items-center"><h3 className="text-xl font-bold text-white">{viewMode === 'visiting' ? 'Historial de Apuestas (Solo Lectura)' : 'Mis Apuestas'}</h3>{viewMode === 'personal' && activeBankData && (<button onClick={() => { setEditingBetId(null); setShowBetForm(true); setFormErrors({}); setIsCustomBookmaker(false); }} className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 font-medium text-sm transition-colors"><Plus size={16}/> Añadir Apuesta</button>)}</div>
                    {activeBetsData.length===0?<div className="bg-[#0F1629] border border-slate-800/50 rounded-xl p-8 text-center text-slate-500 text-sm">No hay apuestas registradas en esta banca.</div>:
                    <div className="space-y-4">
                        {betsByMonth.map(g=>(
                        <div key={g.id} className="border border-slate-800/50 rounded-xl overflow-hidden bg-[#0F1629]">
                            <div onClick={()=>toggleMonth(g.id)} className="flex items-center justify-between p-4 bg-[#151b2e] cursor-pointer hover:bg-[#1e2538] transition-colors"><div className="flex items-center gap-3">{expandedMonths[g.id]?<ChevronUp size={18} className="text-slate-400"/>:<ChevronDown size={18} className="text-slate-400"/>}<span className="font-bold text-white text-sm md:text-base">{g.label}</span></div><div className={`px-3 py-1 rounded text-sm font-bold ${g.profit>=0?'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20':'bg-red-500/10 text-red-400 border border-red-500/20'}`}>{g.profit>0?'+':''}{formatCurrency(g.profit, activeBankData?.currency)}</div></div>
                            {expandedMonths[g.id]&&(
                                <div className="overflow-x-auto border-t border-slate-800/50">
                                    <table className="w-full text-left text-sm whitespace-nowrap">
                                        <thead className="bg-[#0B1120] text-slate-500 text-xs uppercase tracking-wider"><tr><th className="px-4 py-3">Fecha</th><th className="px-4 py-3">Evento</th><th className="px-4 py-3 text-center">Stake</th><th className="px-4 py-3 text-center">Cuota</th><th className="px-4 py-3 text-center">P/L</th><th className="px-4 py-3 text-center">Estado</th>{viewMode === 'personal' && <th className="px-4 py-3 text-center"></th>}</tr></thead>
                                        <tbody className="divide-y divide-slate-800/50">
                                            {g.bets.map(b=>{
                                                const amt=b.amount?parseFloat(b.amount):parseFloat(b.stake)*10;const pl=b.status==='won'?(amt*b.odds)-amt:b.status==='lost'?-amt:0;const isExp=expandedBetId===b.id;
                                                return(
                                                    <React.Fragment key={b.id}>
                                                        <tr className={`hover:bg-slate-800/30 cursor-pointer transition-colors ${isExp?'bg-slate-800/40':''}`} onClick={()=>setExpandedBetId(isExp?null:b.id)}><td className="px-4 py-3 text-slate-400 text-xs">{formatDate(b.date)}</td><td className="px-4 py-3"><div className="font-medium text-white max-w-[150px] md:max-w-xs truncate">{b.title}</div><div className="text-xs text-slate-500 max-w-[150px] md:max-w-xs truncate">{typeof b.selection==='string'?b.selection:'Múltiple'}</div></td><td className="px-4 py-3 text-center text-slate-300">{b.stake}%</td><td className="px-4 py-3 text-center text-yellow-500 font-bold">@{b.odds.toFixed(2)}</td><td className={`px-4 py-3 text-center font-bold ${pl>0?'text-emerald-400':pl<0?'text-red-400':'text-slate-500'}`}>{pl>0?'+':''}{formatCurrency(pl,activeBankData?.currency)}</td><td className="px-4 py-3 text-center"><div onClick={(e)=>{if(viewMode==='personal'){e.stopPropagation();setStatusModalData({id:b.id,currentStatus:b.status});}}} className={viewMode==='personal'?'cursor-pointer':''}><StatusBadge status={b.status}/></div></td>
                                                        {viewMode === 'personal' && <td className="px-4 py-3 text-center"><div className="flex items-center justify-center gap-2"><button onClick={(e)=>{e.stopPropagation();handleEditClick(b);}} className="text-blue-400 hover:text-blue-300 p-1 rounded hover:bg-blue-500/10"><Edit2 size={14}/></button><button onClick={(e)=>{e.stopPropagation();handleDeleteBet(b.id);}} className="text-red-400 hover:text-red-300 p-1 rounded hover:bg-red-500/10"><Trash2 size={14}/></button></div></td>}
                                                        </tr>
                                                        {isExp&&(<tr className="bg-[#0B1120]/50"><td colSpan={viewMode==='personal'?7:6} className="p-4 border-b border-slate-800/50"><div className="space-y-4"><div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs text-slate-400"><div className="p-3 bg-slate-800/30 rounded border border-slate-700/50"><span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Casa</span><span className="text-white font-medium">{b.bookmaker}</span></div><div className="p-3 bg-slate-800/30 rounded border border-slate-700/50"><span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Hora</span><span className="text-white font-medium">{b.time}</span></div>{b.commission&&<div className="p-3 bg-slate-800/30 rounded border border-slate-700/50"><span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Comisión</span><span className="text-white font-medium">{b.commission}%</span></div>}</div>{b.selections&&b.selections.map((s,i)=>(<div key={i} className="bg-slate-800/30 p-3 rounded border border-slate-700/50 flex justify-between items-center"><div><div className="text-white text-sm font-bold">{s.title}</div><div className="text-slate-400 text-xs">{s.selection}</div><div className="text-[10px] text-slate-500">{s.competition} • {s.category}</div></div><div className="text-right"><div className="text-yellow-500 font-bold">@{parseFloat(s.odds).toFixed(2)}</div><div className="text-slate-500 text-xs">{s.bookmaker}</div></div></div>))}{b.analysis&&(<div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700/50"><h4 className="text-emerald-400 font-bold mb-1 flex items-center gap-2 text-xs"><FileText size={12}/> Análisis del Pick</h4><p className="text-slate-300 text-xs leading-relaxed whitespace-pre-wrap">{b.analysis}</p></div>)}</div></td></tr>)}
                                                    </React.Fragment>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                        ))}
                    </div>}
                    </div>
                )}

                {activeTab === 'settings' && viewMode === 'personal' && (
                    <div className="max-w-2xl mx-auto space-y-6 pb-20 md:pb-0">
                        <div className="bg-[#0F1629] border border-slate-800/50 rounded-2xl p-6 shadow-xl">
                            <div className="flex justify-between items-center mb-8 border-b border-slate-800/50 pb-4"><div><h3 className="text-xl font-bold text-white">Configuración de Banca</h3><p className="text-slate-400 text-sm mt-1">hasta 5 bancas y 5.000 apuestas por banca</p></div>{banks.length < LIMITS.MAX_BANKS && (<button onClick={openAddBankModal} className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors shadow-lg shadow-emerald-500/20"><Plus size={16} /> Nueva Banca</button>)}</div>
                            <div className="space-y-4">{banks.map((bank) => (<div key={bank.id} className={`relative p-5 rounded-xl border transition-all duration-300 ${bank.id === currentBankId ? 'bg-gradient-to-br from-emerald-900/10 to-emerald-900/5 border-emerald-500/40 shadow-lg shadow-emerald-500/5' : 'bg-[#151b2e] border-slate-700 hover:border-slate-600'}`}>{bank.id === currentBankId && (<div className="absolute -top-2.5 -right-2.5 bg-emerald-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm border border-emerald-400">ACTIVA</div>)}<div className="flex flex-col sm:flex-row justify-between gap-6"><div className="flex-1 space-y-4"><div className="space-y-1"><label className="text-xs text-slate-500 uppercase font-bold tracking-wider">Nombre</label><input type="text" defaultValue={bank.name} onBlur={(e) => { if (e.target.value !== bank.name) handleUpdateBank(bank.id, 'name', e.target.value); }} className="w-full bg-transparent border-b border-slate-600 focus:border-emerald-500 text-lg font-bold text-white outline-none py-1 transition-colors placeholder-slate-600" /></div><div className="flex gap-3"><div className="flex-1 space-y-1"><label className="text-xs text-slate-500 uppercase font-bold tracking-wider">Capital <Lock size={12} className="text-slate-500"/></label><input type="number" value={bank.initialCapital} disabled className="w-full bg-[#0B1120] border border-slate-700 rounded-lg px-3 py-2 text-slate-400 font-bold outline-none transition-colors text-sm cursor-not-allowed opacity-70" /></div><div className="w-24 space-y-1"><label className="text-xs text-slate-500 uppercase font-bold tracking-wider">Divisa</label><select value={bank.currency || 'EUR'} onChange={(e) => { handleUpdateBank(bank.id, 'currency', e.target.value); }} className="w-full bg-[#0B1120] border border-slate-700 rounded-lg px-2 py-2 text-white text-sm outline-none"><option value="EUR">EUR (€)</option><option value="USD">USD ($)</option><option value="GBP">GBP (£)</option><option value="MXN">MXN ($)</option></select></div></div></div><div className="flex flex-row sm:flex-col justify-between items-end gap-3 border-t sm:border-t-0 sm:border-l border-slate-700/50 pt-4 sm:pt-0 sm:pl-6 min-w-[140px]"><button onClick={() => setCurrentBankId(bank.id)} disabled={bank.id === currentBankId} className={`w-full px-3 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-all ${bank.id === currentBankId ? 'bg-emerald-500/20 text-emerald-400 cursor-default ring-1 ring-emerald-500/30' : 'bg-slate-700 text-slate-300 hover:bg-emerald-600 hover:text-white'}`}>{bank.id === currentBankId ? 'Activa' : 'Seleccionar'}</button><button onClick={() => handleDeleteBank(bank.id)} className="w-full px-3 py-2 text-xs font-medium text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors flex items-center justify-center gap-2 group"><Trash2 size={14} className="group-hover:scale-110 transition-transform"/> Eliminar</button></div></div></div>))}</div>
                        </div>
                        <div className="bg-[#0F1629] border border-slate-800/50 rounded-2xl p-6 shadow-xl">
                            <div className="mb-4"><h3 className="text-lg font-bold text-white flex items-center gap-2"><FileText size={20} className="text-emerald-500" /> Datos y Respaldo</h3><p className="text-slate-400 text-xs mt-1">Exporta tu historial o importa desde Bet-Analytix (CSV)</p></div>
                            <div className="flex gap-4"><button onClick={handleExportCSV} className="flex-1 bg-[#1A2035] hover:bg-[#232b45] border border-slate-700 hover:border-emerald-500/50 text-white p-4 rounded-xl transition-all group flex flex-col items-center gap-2"><div className="p-3 bg-[#0B1120] rounded-full group-hover:bg-emerald-500/20 transition-colors"><Download size={24} className="text-slate-400 group-hover:text-emerald-400" /></div><span className="text-sm font-medium">Exportar CSV</span></button><div className="flex-1 relative"><input type="file" accept=".csv" ref={fileInputRef} onChange={handleImportCSV} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" /><div className="bg-[#1A2035] hover:bg-[#232b45] border border-slate-700 hover:border-blue-500/50 text-white p-4 rounded-xl transition-all group flex flex-col items-center gap-2 h-full"><div className="p-3 bg-[#0B1120] rounded-full group-hover:bg-blue-500/20 transition-colors"><Upload size={24} className="text-slate-400 group-hover:text-blue-400" /></div><span className="text-sm font-medium">Importar CSV</span></div></div></div>
                        </div>
                    </div>
                )}

                {activeTab === 'customization' && viewMode === 'personal' && (
                    <div className="max-w-2xl mx-auto space-y-6 pb-20 md:pb-0">
                        <div className="bg-[#0F1629] border border-slate-800/50 rounded-2xl p-6 shadow-xl">
                            <div className="mb-6"><h3 className="text-xl font-bold text-white flex items-center gap-2"><Tags size={20} className="text-emerald-500" /> Personalización</h3><p className="text-slate-400 text-sm mt-1">Añade tus propios deportes y categorías.</p></div>
                            <div className="space-y-6">
                                <div className="bg-[#151b2e] p-4 rounded-xl border border-slate-700/50">
                                    <h4 className="text-sm font-bold text-slate-300 mb-3 uppercase tracking-wider">Deportes</h4>
                                    <div className="flex gap-2 mb-3"><input type="text" value={newCustomSport} onChange={e => setNewCustomSport(e.target.value)} placeholder="Ej: Ping Pong" className="flex-1 bg-[#0B1120] border border-slate-700 rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-emerald-500"/><button onClick={() => handleAddOption('sports', newCustomSport)} className="bg-emerald-600 hover:bg-emerald-500 text-white p-2 rounded-lg"><Plus size={18}/></button></div>
                                    <div className="flex flex-wrap gap-2">{(customOptions.sports || []).map(sport => (<span key={sport} className="px-3 py-1 bg-slate-700/50 text-slate-300 rounded-full text-xs flex items-center gap-2 border border-slate-600">{sport} <button onClick={() => handleDeleteOption('sports', sport)} className="hover:text-red-400"><X size={12}/></button></span>))}{(!customOptions.sports || customOptions.sports.length === 0) && <span className="text-xs text-slate-500 italic">No hay deportes personalizados.</span>}</div>
                                </div>
                                <div className="bg-[#151b2e] p-4 rounded-xl border border-slate-700/50">
                                    <h4 className="text-sm font-bold text-slate-300 mb-3 uppercase tracking-wider">Categorías</h4>
                                    <div className="flex gap-2 mb-3"><input type="text" value={newCustomCategory} onChange={e => setNewCustomCategory(e.target.value)} placeholder="Ej: NBA Playoffs" className="flex-1 bg-[#0B1120] border border-slate-700 rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-emerald-500"/><button onClick={() => handleAddOption('categories', newCustomCategory)} className="bg-emerald-600 hover:bg-emerald-500 text-white p-2 rounded-lg"><Plus size={18}/></button></div>
                                    <div className="flex flex-wrap gap-2">{(customOptions.categories || []).map(cat => (<span key={cat} className="px-3 py-1 bg-slate-700/50 text-slate-300 rounded-full text-xs flex items-center gap-2 border border-slate-600">{cat} <button onClick={() => handleDeleteOption('categories', cat)} className="hover:text-red-400"><X size={12}/></button></span>))}{(!customOptions.categories || customOptions.categories.length === 0) && <span className="text-xs text-slate-500 italic">No hay categorías personalizadas.</span>}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
            </main>

            {showBetForm && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
                <div className="bg-[#0B1120] w-full max-w-lg rounded-2xl shadow-2xl border border-slate-800 overflow-hidden flex flex-col max-h-[90vh]">
                    <div className="px-5 py-4 border-b border-slate-800 flex justify-between items-center bg-[#0F1629]"><h3 className="font-bold text-white text-lg">{editingBetId ? 'Editar Apuesta' : 'Añadir Apuesta'}</h3><button onClick={() => setShowBetForm(false)} className="text-slate-400 hover:text-white"><X size={20}/></button></div>
                    <div className="p-5 overflow-y-auto space-y-4 custom-scrollbar">
                        
                        {/* --- BOTÓN DE IA AQUÍ --- */}
                        <div className="mb-2 bg-emerald-900/20 border border-emerald-500/30 p-4 rounded-xl text-center relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-2 opacity-10 pointer-events-none"><Crown size={40}/></div>
                            <p className="text-xs text-emerald-300 mb-3 font-medium flex items-center justify-center gap-2">
                                <TrendingUp size={14}/> Auto-rellenar con Inteligencia Artificial
                            </p>
                            <label className={`cursor-pointer ${isScanning ? 'bg-slate-600 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-500'} text-white px-4 py-2 rounded-lg font-bold shadow-lg flex items-center justify-center gap-2 mx-auto w-fit transition-all`}>
                                <Upload size={16}/> {isScanning ? 'Analizando captura...' : 'Escanear Boleto'}
                                <input
                                    type="file"
                                    accept="image/*"
                                    onChange={escanearBoleto}
                                    className="hidden"
                                    disabled={isScanning}
                                />
                            </label>
                        </div>
                        {/* ------------------------ */}

                        <div className="grid grid-cols-2 gap-3"><div className="bg-[#151b2e] border border-slate-700/50 rounded-lg p-2 flex items-center justify-between"><input type="date" className="bg-transparent text-white text-sm outline-none w-full" value={newBet.date} onChange={e => setNewBet({...newBet, date: e.target.value})} /> <Calendar size={14} className="text-slate-500" /></div><div className="bg-[#151b2e] border border-slate-700/50 rounded-lg p-2 flex items-center justify-between"><input type="time" className="bg-transparent text-white text-sm outline-none w-full" value={newBet.time} onChange={e => setNewBet({...newBet, time: e.target.value})} /> <Clock size={14} className="text-slate-500" /></div></div>
                        <div className="space-y-1"><label className="text-xs text-slate-500 ml-1">Casa de apuestas</label>{isCustomBookmaker ? (<div className="flex gap-2"><input type="text" placeholder="Escribe el nombre..." className="w-full bg-[#151b2e] border border-slate-700/50 rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-emerald-500" autoFocus value={newBet.bookmaker} onChange={(e) => setNewBet(prev => ({ ...prev, bookmaker: e.target.value }))} /><button onClick={() => { setIsCustomBookmaker(false); setNewBet(prev => ({ ...prev, bookmaker: 'Bet365' })); }} className="text-xs text-red-400 hover:text-white underline">Cancelar</button></div>) : (<select className="w-full bg-[#151b2e] border border-slate-700/50 rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-emerald-500" value={newBet.bookmaker} onChange={handleBookieChange}>{COMMON_BOOKMAKERS.map(b => <option key={b}>{b}</option>)}<option value="Otra">Otra...</option></select>)}</div>
                        
                        {newBet.selections.map((sel, index) => (
                            <div key={sel.id} className="border border-slate-700/50 rounded-xl bg-[#151b2e]/50 overflow-hidden">
                                <div className="flex items-center justify-between p-3 cursor-pointer bg-slate-800/30 hover:bg-slate-800/50" onClick={() => toggleSelection(sel.id)}><div className="flex items-center gap-2 text-xs text-emerald-400 font-medium"><ChevronDown size={14} className={`transform transition-transform ${sel.isOpen ? 'rotate-180' : ''}`} /> Selección {index + 1}</div>{newBet.selections.length > 1 && (<button onClick={(e) => { e.stopPropagation(); handleRemoveSelection(sel.id); }} className="text-slate-500 hover:text-red-400"><X size={14}/></button>)}</div>
                                {sel.isOpen && (
                                    <div className="p-4 space-y-3 border-t border-slate-700/50 animate-in slide-in-from-top-2">
                                        <div className="grid grid-cols-3 gap-3"><div className="col-span-2 space-y-1"><label className="text-[10px] text-slate-500">Evento / Partido</label><input type="text" placeholder="Ej: Real Madrid - Barcelona" className="w-full bg-[#0B1120] border border-slate-700 rounded-lg px-3 py-2 text-white text-sm outline-none" value={sel.title} onChange={e => handleUpdateSelection(sel.id, 'title', e.target.value)} /></div><div className="space-y-1"><label className="text-[10px] text-slate-500">Cuota</label><input type="number" step="0.01" className="w-full bg-[#0B1120] border border-slate-700 rounded-lg px-3 py-2 text-white text-sm outline-none" value={sel.odds} onChange={e => handleUpdateSelection(sel.id, 'odds', e.target.value)} /></div></div>
                                        <div className="space-y-1"><label className="text-[10px] text-slate-500">Mercado / Pronóstico</label><input type="text" placeholder="Ej: Gana Local, Más de 2.5 Goles..." className="w-full bg-[#0B1120] border border-slate-700 rounded-lg px-3 py-2 text-white text-sm outline-none" value={sel.selection} onChange={e => handleUpdateSelection(sel.id, 'selection', e.target.value)} /></div>
                                        <div className="grid grid-cols-2 gap-3"><div className="space-y-1"><label className="text-[10px] text-slate-500">Deporte</label><select className="w-full bg-[#0B1120] border border-slate-700 rounded-lg px-3 py-2 text-white text-sm outline-none" value={sel.sport} onChange={e => handleUpdateSelection(sel.id, 'sport', e.target.value)}><option>Fútbol</option><option>Baloncesto</option><option>Tenis</option><option>Esports</option></select></div><div className="space-y-1"><label className="text-[10px] text-slate-500">Estado</label><select className="w-full bg-[#0B1120] border border-slate-700 rounded-lg px-3 py-2 text-white text-sm outline-none" value={sel.status} onChange={e => handleUpdateSelection(sel.id, 'status', e.target.value)}><option value="pending">Pendiente</option><option value="won">Ganada</option><option value="lost">Perdida</option><option value="void">Nula</option></select></div></div>
                                        <div className="grid grid-cols-2 gap-3"><div className="space-y-1"><label className="text-[10px] text-slate-500">Categoría</label><input type="text" placeholder="Ej: Premium, Reto..." className="w-full bg-[#0B1120] border border-slate-700 rounded-lg px-3 py-2 text-white text-sm outline-none" value={sel.category} onChange={e => handleUpdateSelection(sel.id, 'category', e.target.value)} /></div><div className="space-y-1"><label className="text-[10px] text-slate-500">Competición</label><input type="text" placeholder="Seleccionar" className="w-full bg-[#0B1120] border border-slate-700 rounded-lg px-3 py-2 text-white text-sm outline-none" value={sel.competition} onChange={e => handleUpdateSelection(sel.id, 'competition', e.target.value)} /></div></div>
                                        <div className="flex justify-center pt-2"><button className="text-xs text-indigo-400 flex items-center gap-1 hover:text-indigo-300" onClick={(e) => { e.stopPropagation(); toggleSelection(sel.id); }}><ChevronUp size={12}/> Menos detalles</button></div>
                                    </div>
                                )}
                            </div>
                        ))}
                        <button onClick={handleAddSelection} className="w-full py-2 border border-dashed border-slate-600 rounded-lg text-slate-400 hover:text-white hover:border-emerald-500 hover:bg-slate-800/50 flex items-center justify-center gap-2 text-sm transition-all"><Plus size={16} /> Añadir una selección</button>
                        
                        {newBet.selections.length > 1 && (<div className="space-y-1 pt-2"><label className="text-xs text-slate-400 font-medium">Nombre de la Combinada</label><input type="text" placeholder="Ej: Combinada Fin de Semana" className="w-full bg-[#151b2e] border border-slate-700 rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-indigo-500 transition-colors" value={newBet.title} onChange={e => setNewBet(prev => ({ ...prev, title: e.target.value }))} /></div>)}
                        
                        <div className="bg-[#151b2e] rounded-xl p-4 space-y-4">
                            <div className="space-y-2"><label className="text-xs text-slate-400 font-medium flex justify-between">Importe {formErrors.amount && <span className="text-red-400 text-[10px] flex items-center gap-1"><AlertTriangle size={10}/> {formErrors.amount}</span>}</label><div className="flex gap-3"><div className={`flex-1 bg-[#0B1120] border ${formErrors.amount ? 'border-red-500/50' : 'border-slate-700'} rounded-lg p-2 relative group focus-within:border-emerald-500 transition-colors`}><span className="text-[10px] text-slate-500 block uppercase tracking-wide">Importe ({currencySymbol})</span><input type="number" className="bg-transparent text-white w-full outline-none font-bold text-lg" value={newBet.amount || ''} onChange={e => handleAmountChange(e.target.value, 'amount')} placeholder="0" /></div><div className="flex-1 bg-[#0B1120] border border-slate-700 rounded-lg p-2 relative group focus-within:border-emerald-500 transition-colors"><span className="text-[10px] text-slate-500 block uppercase tracking-wide">% Capital</span><input type="number" className="bg-transparent text-white w-full outline-none font-bold text-lg" value={newBet.stake || ''} onChange={e => handleAmountChange(e.target.value, 'stake')} placeholder="0" /></div></div><div className="grid grid-cols-4 gap-2 mt-2">{[10, 20, 50, 100].map(val => (<button key={val} onClick={() => handleAmountChange(val, 'amount')} className="bg-[#0B1120] hover:bg-slate-700 border border-slate-700 rounded py-1.5 text-xs text-slate-300 transition-colors font-medium">{val}{currencySymbol}</button>))}</div></div>
                            <button onClick={() => setShowMoreOptions(!showMoreOptions)} className="w-full text-center text-xs text-indigo-400 font-medium hover:text-indigo-300 flex items-center justify-center gap-1 mt-2 transition-colors border-t border-slate-800/50 pt-2">{showMoreOptions ? <ChevronUp size={14}/> : <ChevronDown size={14}/>} {showMoreOptions ? 'Menos opciones' : 'Más opciones'}</button>
                            {showMoreOptions && (<div className="grid grid-cols-2 gap-3 pt-2 animate-in fade-in slide-in-from-top-2"><div className="space-y-1"><label className="text-[10px] text-slate-500">Comisión %</label><input type="number" className="w-full bg-[#0B1120] border border-slate-700 rounded-lg px-3 py-2 text-white text-sm outline-none" value={newBet.commission} onChange={e => setNewBet({...newBet, commission: e.target.value})} placeholder="0"/></div><div className="space-y-1"><label className="text-[10px] text-slate-500">Bono</label><input type="number" className="w-full bg-[#0B1120] border border-slate-700 rounded-lg px-3 py-2 text-white text-sm outline-none" value={newBet.bonus} onChange={e => setNewBet({...newBet, bonus: e.target.value})} placeholder="0"/></div><div className="flex items-center gap-2 bg-[#0B1120] p-2 rounded border border-slate-700"><input type="checkbox" checked={newBet.isLive} onChange={e => setNewBet({...newBet, isLive: e.target.checked})} className="accent-emerald-500"/><label className="text-xs text-slate-400">En Vivo (Live)</label></div><div className="flex items-center gap-2 bg-[#0B1120] p-2 rounded border border-slate-700"><input type="checkbox" checked={newBet.isFreebet} onChange={e => setNewBet({...newBet, isFreebet: e.target.checked})} className="accent-pink-500"/><label className="text-xs text-slate-400">Apuesta Gratis</label></div><div className="flex items-center gap-2 bg-[#0B1120] p-2 rounded border border-slate-700"><input type="checkbox" checked={newBet.isEachWay} onChange={e => setNewBet({...newBet, isEachWay: e.target.checked})} className="accent-blue-500"/><label className="text-xs text-slate-400">Each-Way</label></div><div className="space-y-1"><label className="text-[10px] text-slate-500">Cierre</label><input type="number" className="w-full bg-[#0B1120] border border-slate-700 rounded-lg px-3 py-2 text-white text-sm outline-none" value={newBet.cashout} onChange={e => setNewBet({...newBet, cashout: e.target.value})} placeholder="0"/></div></div>)}
                        </div>
                        
                        {userRole === 'tipster' && (<div className="space-y-1 pt-2"><label className="text-xs text-slate-500 ml-1">Tipster</label><select className="w-full bg-[#151b2e] border border-slate-700/50 rounded-lg px-3 py-2.5 text-white text-sm outline-none" value={newBet.tipster} onChange={e => setNewBet({...newBet, tipster: e.target.value})}><option>Money Tips</option><option>Admin</option><option>Invitado</option></select></div>)}
                        <div className="space-y-1 border-t border-slate-800/50 pt-3"><label className="text-xs text-slate-500 flex justify-between"><span>Análisis / Comentario</span><span className={`${newBet.analysis?.length > 1100 ? 'text-red-400' : 'text-slate-600'}`}>{newBet.analysis?.length || 0}/1200</span></label><textarea className="w-full bg-[#151b2e] border border-slate-700/50 rounded-lg p-3 text-white text-sm outline-none focus:border-emerald-500 min-h-[100px] resize-none" placeholder="Escribe aquí tu análisis..." maxLength={1200} value={newBet.analysis} onChange={e => setNewBet({...newBet, analysis: e.target.value})} /></div>
                    </div>
                    <div className="p-5 border-t border-slate-800 bg-[#0F1629]"><button onClick={handleSaveBet} className="w-full bg-[#6366f1] hover:bg-[#4f46e5] text-white font-bold py-3 rounded-lg flex items-center justify-center gap-2 transition-all shadow-lg shadow-indigo-500/20"><CheckCircle2 size={18} /> {editingBetId ? 'Actualizar apuesta' : 'Guardar apuesta'}</button></div>
                </div>
            </div>
            )}

            {isAddingBank && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-[#0B1120] w-full max-w-sm rounded-2xl shadow-2xl border border-slate-800 overflow-hidden flex flex-col">
                        <div className="px-5 py-4 border-b border-slate-800 flex justify-between items-center bg-[#0F1629]"><h3 className="font-bold text-white text-lg">Nueva Banca</h3><button onClick={() => setIsAddingBank(false)} className="text-slate-400 hover:text-white"><X size={20}/></button></div>
                        <div className="p-6 space-y-4">
                            <div className="space-y-1"><label className="text-xs text-slate-500 uppercase font-bold tracking-wider">Nombre</label><input type="text" placeholder="Ej: Bet365 Principal" className="w-full bg-[#151b2e] border border-slate-700 rounded-lg px-3 py-2 text-white focus:border-emerald-500 outline-none transition-colors" value={newBankData.name} onChange={e => setNewBankData({...newBankData, name: e.target.value})} autoFocus /></div>
                            <div className="space-y-1"><label className="text-xs text-slate-500 uppercase font-bold tracking-wider flex items-center gap-2">Capital Inicial<div className="relative group"><HelpCircle size={12} className="text-yellow-500 cursor-help"/><div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 bg-yellow-900/90 text-yellow-100 text-[10px] p-2 rounded shadow-xl border border-yellow-700/50 hidden group-hover:block z-50 pointer-events-none">Define el capital inicial correctamente. Una vez creado, NO se podrá modificar para asegurar la integridad de las estadísticas.</div></div></label><input type="number" placeholder="1000" className="w-full bg-[#151b2e] border border-slate-700 rounded-lg px-3 py-2 text-white focus:border-emerald-500 outline-none transition-colors" value={newBankData.initialCapital} onChange={e => setNewBankData({...newBankData, initialCapital: e.target.value})} /></div>
                            <div className="space-y-1"><label className="text-xs text-slate-500 uppercase font-bold tracking-wider">Divisa</label><select className="w-full bg-[#151b2e] border border-slate-700 rounded-lg px-3 py-2 text-white focus:border-emerald-500 outline-none transition-colors" value={newBankData.currency} onChange={e => setNewBankData({...newBankData, currency: e.target.value})}><option value="EUR">EUR (€)</option><option value="USD">USD ($)</option><option value="GBP">GBP (£)</option><option value="MXN">MXN ($)</option></select></div>
                            <button onClick={confirmAddBank} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-lg transition-all shadow-lg shadow-emerald-500/20 mt-2">Crear Banca</button>
                        </div>
                    </div>
                </div>
            )}

            {statusModalData && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-[#0B1120] rounded-xl shadow-2xl border border-slate-800 p-6 w-full max-w-sm"><h3 className="text-white font-bold mb-4 text-center">Actualizar Estado</h3><div className="grid grid-cols-2 gap-3"><button onClick={() => handleQuickStatusChange('won')} className="p-3 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 rounded-lg font-bold border border-emerald-500/30 transition-all flex flex-col items-center gap-1"><CheckCircle2/> Ganada</button><button onClick={() => handleQuickStatusChange('lost')} className="p-3 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg font-bold border border-red-500/30 transition-all flex flex-col items-center gap-1"><XCircle/> Perdida</button><button onClick={() => handleQuickStatusChange('void')} className="p-3 bg-slate-700/50 hover:bg-slate-700 text-slate-300 rounded-lg font-bold border border-slate-600 transition-all flex flex-col items-center gap-1"><AlertCircle/> Nula</button><button onClick={() => handleQuickStatusChange('pending')} className="p-3 bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400 rounded-lg font-bold border border-yellow-500/30 transition-all flex flex-col items-center gap-1"><Clock/> Pendiente</button></div><button onClick={() => setStatusModalData(null)} className="mt-4 w-full py-2 text-slate-500 text-sm hover:text-white">Cancelar</button></div>
                </div>
            )}
        </div>
        </>
    );
}

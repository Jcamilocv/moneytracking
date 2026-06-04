import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
    LayoutDashboard, List, Settings, Plus, TrendingUp, Wallet, Menu, X, 
    ChevronDown, ChevronUp, Trash2, Edit2, CheckCircle2, Crown,
    Clock, Calendar, Download, Upload, FileText, 
    ArrowUpRight, ArrowDownRight, AlertTriangle, 
    BarChart2, LineChart, Tags, LogOut, Database, Eye, Link as LinkIcon, CalendarDays,
    HelpCircle, Lock, ShieldCheck, XCircle, AlertCircle, Sun, Moon, Layers, Code
} from 'lucide-react';
import { 
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
    BarChart, Bar, Cell, Line, LineChart as ReLineChart 
} from 'recharts';

// --- FIREBASE IMPORTS ---
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";
import { getFirestore, collection, onSnapshot, addDoc, doc, deleteDoc, updateDoc, setDoc, writeBatch } from "firebase/firestore";

// --- CONFIGURACIÓN DE FIREBASE ---
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

// --- ESTILOS GLOBALES & THEME ---
const getGlobalStyles = (theme) => {
    const isDark = theme === 'dark';
    return `
    :root {
        --bg-base: ${isDark ? '#081225' : '#F4F7FB'};
        --bg-base-95: ${isDark ? 'rgba(8,18,37,0.95)' : 'rgba(244,247,251,0.95)'};
        --bg-card: ${isDark ? '#111D36' : '#FFFFFF'};
        --bg-input: ${isDark ? '#050A14' : '#F8FAFC'};
        --bg-hover: ${isDark ? '#1A2A4D' : '#F1F5F9'};
        
        --bg-overlay: ${isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'};
        --bg-overlay-hover: ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'};
        --bg-modal: ${isDark ? 'rgba(0,0,0,0.7)' : 'rgba(15,23,42,0.4)'};
        
        --text-main: ${isDark ? '#F1F5F9' : '#0F172A'};
        --text-muted: ${isDark ? '#94A3B8' : '#64748B'};
        
        --border: ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)'};
        --border-strong: ${isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.15)'};
        
        --accent: ${isDark ? '#5EE6B1' : '#2563EB'};
        --accent-hover: ${isDark ? '#48D19F' : '#1D4ED8'};
        --accent-fg: ${isDark ? '#050A14' : '#FFFFFF'};
        
        --accent-5: ${isDark ? 'rgba(94,230,177,0.05)' : 'rgba(37,99,235,0.05)'};
        --accent-10: ${isDark ? 'rgba(94,230,177,0.1)' : 'rgba(37,99,235,0.1)'};
        --accent-20: ${isDark ? 'rgba(94,230,177,0.2)' : 'rgba(37,99,235,0.2)'};
        --accent-30: ${isDark ? 'rgba(94,230,177,0.3)' : 'rgba(37,99,235,0.3)'};
        --accent-40: ${isDark ? 'rgba(94,230,177,0.4)' : 'rgba(37,99,235,0.4)'};
        --accent-50: ${isDark ? 'rgba(94,230,177,0.5)' : 'rgba(37,99,235,0.5)'};
        --accent-80: ${isDark ? 'rgba(94,230,177,0.8)' : 'rgba(37,99,235,0.8)'};
        
        --red: ${isDark ? '#FF5A5F' : '#EF4444'};
        --red-10: ${isDark ? 'rgba(255,90,95,0.1)' : 'rgba(239,68,68,0.1)'};
        --red-20: ${isDark ? 'rgba(255,90,95,0.2)' : 'rgba(239,68,68,0.2)'};
        --red-30: ${isDark ? 'rgba(255,90,95,0.3)' : 'rgba(239,68,68,0.3)'};
        
        --yellow: ${isDark ? '#FACC15' : '#D97706'};
        
        --shadow-glow-sm: ${isDark ? '0 0 10px rgba(94,230,177,0.2)' : '0 0 10px rgba(37,99,235,0.15)'};
        --shadow-glow-md: ${isDark ? '0 0 15px rgba(94,230,177,0.3)' : '0 0 15px rgba(37,99,235,0.2)'};
        --shadow-glow-lg: ${isDark ? '0 0 25px rgba(94,230,177,0.5)' : '0 0 25px rgba(37,99,235,0.3)'};
        --shadow-red: ${isDark ? '0 0 10px rgba(255,90,95,0.1)' : '0 0 10px rgba(239,68,68,0.1)'};
        --shadow-yellow: ${isDark ? '0 0 10px rgba(234,179,8,0.1)' : '0 0 10px rgba(217,119,6,0.1)'};
    }
    body { background-color: var(--bg-base); color: var(--text-main); margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; transition: background-color 0.3s ease, color 0.3s ease; }
    
    .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
    .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
    .custom-scrollbar::-webkit-scrollbar-thumb { background-color: var(--bg-overlay-hover); border-radius: 10px; transition: all 0.3s; }
    .custom-scrollbar::-webkit-scrollbar-thumb:hover { background-color: var(--text-muted); }
    
    .animate-in { animation: fadeIn 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    .slide-in { animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
    @keyframes slideIn { from { transform: translateX(-100%); } to { transform: translateX(0); } }
    `;
};

const LiquidBackground = ({ theme }) => (
    <div className="fixed inset-0 z-[-1] overflow-hidden pointer-events-none bg-[var(--bg-base)] transition-colors duration-500">
        <div className={`absolute top-[-20%] left-[-10%] w-[50vw] h-[50vw] rounded-full blur-[120px] mix-blend-screen transition-colors duration-1000 ${theme === 'dark' ? 'bg-[#5EE6B1]/5' : 'bg-blue-500/10'}`}></div>
        <div className={`absolute bottom-[-20%] right-[-10%] w-[60vw] h-[60vw] rounded-full blur-[150px] mix-blend-screen transition-colors duration-1000 ${theme === 'dark' ? 'bg-indigo-500/5' : 'bg-indigo-500/10'}`}></div>
        <div className={`absolute top-[40%] left-[60%] w-[30vw] h-[30vw] rounded-full blur-[100px] mix-blend-screen transition-colors duration-1000 ${theme === 'dark' ? 'bg-[#5EE6B1]/5' : 'bg-blue-400/10'}`}></div>
        <div className={`absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] transition-opacity duration-1000 ${theme === 'dark' ? 'opacity-10 mix-blend-overlay' : 'opacity-[0.03] mix-blend-multiply'}`}></div>
    </div>
);

const LIMITS = { MAX_BANKS: 5, MAX_BETS_PER_BANK: 5000 };

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

const fetchWithRetry = async (url, options, retries = 5) => {
    const delays = [1000, 2000, 4000, 8000, 16000];
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            if (response.ok) return response;
        } catch (e) {
            if (i === retries - 1) throw e;
        }
        if (i < retries - 1) {
            await new Promise(r => setTimeout(r, delays[i]));
        }
    }
    throw new Error("Failed after retries");
};

// --- HELPER ESTADÍSTICAS BÁSICAS ---
const getStatsForBets = (betList, initialCap) => {
    let staked=0, returned=0, runningProfit=0;
    betList.forEach(bet => {
        if(bet.status === 'pending') return;
        const amt = bet.amount || 0; 
        staked += amt; 
        let profit = 0;
        if (bet.status === 'won') { profit = (amt * bet.odds) - amt; returned += (amt * bet.odds); } 
        else if (bet.status === 'lost') { profit = -amt; }
        else if (bet.status === 'half-won') { profit = (amt/2)*(bet.odds-1); returned += (amt + profit); }
        else if (bet.status === 'half-lost') { profit = -(amt/2); returned += (amt/2); }
        runningProfit += profit;
    });
    const yieldPerc = staked > 0 ? (runningProfit / staked) * 100 : 0;
    const progression = initialCap > 0 ? (runningProfit / initialCap) * 100 : 0;
    return { picks: betList.filter(b => b.status !== 'pending').length, profit: runningProfit, yieldPerc, progression };
};

// --- COMPONENTES UI ---
const StatCard = ({ title, value, subValue, isCurrency = false, currency = 'EUR', colorClass = "text-[var(--text-main)]" }) => (
    <div className="p-3 md:p-4 bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl hover:bg-[var(--bg-hover)] transition-all flex flex-col justify-between min-h-[90px] shadow-sm">
        <p className="text-[var(--text-muted)] text-[10px] uppercase tracking-wider font-semibold mb-1 truncate" title={title}>{title}</p>
        <div className="flex-1 flex flex-col justify-end">
            <h3 className={`text-lg md:text-xl font-bold ${colorClass} truncate drop-shadow-sm`}>{isCurrency ? formatCurrency(value, currency) : value}</h3>
            {subValue && <p className="text-[10px] text-[var(--text-muted)] opacity-80 mt-0.5 truncate">{String(subValue)}</p>}
        </div>
    </div>
);

const StatusBadge = ({ status }) => {
    const styles = {
        won: 'bg-[var(--accent-10)] text-[var(--accent)] border-[var(--accent-30)] shadow-[var(--shadow-glow-sm)]', 
        lost: 'bg-[var(--red-10)] text-[var(--red)] border-[var(--red-30)] shadow-[var(--shadow-red)]',
        pending: 'bg-yellow-500/10 text-[var(--yellow)] border-yellow-500/30 shadow-[var(--shadow-yellow)]', 
        void: 'bg-[var(--bg-overlay)] text-[var(--text-muted)] border-[var(--border-strong)]',
        'half-won': 'bg-[var(--accent-10)] text-[var(--accent)] border-[var(--accent-30)]', 
        'half-lost': 'bg-orange-500/10 text-orange-500 border-orange-500/30',
    };
    const labels = { won: 'Ganada', lost: 'Perdida', pending: 'Pendiente', void: 'Nula', 'half-won': 'Mitad Ganada', 'half-lost': 'Mitad Perdida' };
    return <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide border backdrop-blur-md ${styles[status] || styles.pending}`}>{labels[status] || status}</span>;
};

// --- APP PRINCIPAL ---
export default function App() {
    const [initialShare] = useState(() => {
        if (typeof window === 'undefined') return { mode: 'personal', uid: null, bid: null, isEmbed: false };
        const params = new URLSearchParams(window.location.search);
        const sData = params.get('s');
        const isEmbed = params.get('embed') === 'true'; // NUEVO: Detección de iFrame
        if (sData) {
            try {
                const decoded = atob(sData);
                const [uid, bid] = decoded.split('|');
                if (uid && bid) return { mode: 'visiting', uid, bid, isEmbed };
            } catch (e) { console.error("Error decodificando enlace público.", e); }
        }
        return { mode: 'personal', uid: null, bid: null, isEmbed: false };
    });

    const [isEmbed] = useState(initialShare.isEmbed);
    const [theme, setTheme] = useState(() => localStorage.getItem('moneytracking_theme') || 'dark');
    const [currentUser, setCurrentUser] = useState(null);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isRegistering, setIsRegistering] = useState(false);
    const [authError, setAuthError] = useState('');
    const [dbError, setDbError] = useState('');
    
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('dashboard');
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    
    const [banks, setBanks] = useState([]);
    const [balances, setBalances] = useState([]); 
    const [currentBankId, setCurrentBankId] = useState(null);
    const [bets, setBets] = useState([]); 
    const [customOptions, setCustomOptions] = useState({ sports: [], categories: [] });
    
    const [showBetForm, setShowBetForm] = useState(false);
    const [isAddingBank, setIsAddingBank] = useState(false); 
    const [isAddingBalance, setIsAddingBalance] = useState(false); 
    const [editingBetId, setEditingBetId] = useState(null); 
    const [expandedBetId, setExpandedBetId] = useState(null); 
    const [showMoreOptions, setShowMoreOptions] = useState(false);
    const [statusModalData, setStatusModalData] = useState(null); 
    
    const [feedbackModal, setFeedbackModal] = useState({ isOpen: false, type: 'alert', message: '', onConfirm: null });
    const [shareModal, setShareModal] = useState({ isOpen: false, link: '', iframe: '' }); // NUEVO: Modal de Distribución
    
    const [isProcessing, setIsProcessing] = useState(false);
    const [expandedMonths, setExpandedMonths] = useState({});
    const [formErrors, setFormErrors] = useState({}); 
    const [isCustomBookmaker, setIsCustomBookmaker] = useState(false);
    const [chartViewMode, setChartViewMode] = useState('detailed');
    const [barChartViewMode, setBarChartViewMode] = useState('weekly'); 

    const [viewMode, setViewMode] = useState(initialShare.mode); 
    const [visitingUserId, setVisitingUserId] = useState(initialShare.uid);
    const [visitingBankId, setVisitingBankId] = useState(initialShare.bid);
    
    const [unlockedBank, setUnlockedBank] = useState(false);
    const [visitorPasswordInput, setVisitorPasswordInput] = useState('');

    const [newCustomSport, setNewCustomSport] = useState('');
    const [newCustomCategory, setNewCustomCategory] = useState('');
    const [newBankData, setNewBankData] = useState({ name: '', initialCapital: 1000, currency: 'EUR', premiumPassword: '' }); 
    const [newBalanceData, setNewBalanceData] = useState({ name: '', bankIds: [], premiumPassword: '' }); 
    const fileInputRef = useRef(null);
    
    const [isScanning, setIsScanning] = useState(false);
    const [aiMessage, setAiMessage] = useState(''); 

    const [newBet, setNewBet] = useState({
        date: new Date().toISOString().split('T')[0], time: '00:00', bookmaker: 'Bet365', betMode: 'simple', title: '', 
        selections: [{ id: Date.now(), title: '', selection: '', sport: 'Fútbol', status: 'pending', category: '', odds: 1.50, isOpen: true }],
        amount: 0, stake: 0, analysis: '', commission: '', bonus: '', isLive: false, isFreebet: false, cashout: '', isEachWay: false, tipster: 'Money Tips'
    });

    useEffect(() => { localStorage.setItem('moneytracking_theme', theme); }, [theme]);

    const escanearBoleto = async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        setIsScanning(true);
        setAiMessage(''); 
        try {
            const reader = new FileReader();
            reader.onloadend = async () => {
                const base64Data = reader.result.split(',')[1];
                
                const prompt = `Analiza esta captura de pantalla de un boleto de apuestas deportivas. Extrae la siguiente información y devuélvela ÚNICAMENTE en formato JSON válido, sin texto adicional y sin formato markdown (no uses \`\`\`json).
                Además, genera un campo "mensaje_ia" con un mensaje conversacional, directo y amable (como un asistente). Si lograste extraer todo bien (cuota, importe, mercado), dile al usuario que todo está listo. Si notas que falta algo (por ejemplo, si la imagen corta el importe o la cuota), menciónalo educadamente y pídele que lo rellene a mano.
                
                Estructura del JSON:
                {
                  "equipo": "Nombre del equipo o selección",
                  "cuota": "Número decimal (ejemplo: 1.85)",
                  "mercado": "Tipo de apuesta (ejemplo: Ganador, Más de 2.5 goles)",
                  "importe": "Cantidad apostada (ejemplo: 10.50)",
                  "mensaje_ia": "Mensaje personalizado explicando qué has encontrado y si falta algo."
                }`;

                const apiKey = ""; 
                const payload = {
                    contents: [{
                        role: "user",
                        parts: [
                            { text: prompt },
                            { inlineData: { mimeType: file.type, data: base64Data } }
                        ]
                    }]
                };

                const response = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const result = await response.json();
                let responseText = result.candidates?.[0]?.content?.parts?.[0]?.text;
                
                if (!responseText) throw new Error("No text returned from API.");

                responseText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();

                const datosExtraidos = JSON.parse(responseText);
                console.log("Datos extraídos:", datosExtraidos);

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
                if (datosExtraidos.mensaje_ia) {
                    setAiMessage(datosExtraidos.mensaje_ia);
                } else {
                    setAiMessage("✅ ¡Boleto analizado! Revisa los datos auto-rellenados.");
                }
            };
            
            reader.readAsDataURL(file);

        } catch (error) {
            console.error("Error al leer el boleto:", error);
            setIsScanning(false);
            setAiMessage("Hubo un error analizando la imagen. Comprueba que sea legible.");
        }
    };

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            setCurrentUser(user);
            if (!user && viewMode === 'personal') { setLoading(false); setBanks([]); setBets([]); setBalances([]); }
        });
        return () => unsubscribe();
    }, [viewMode]);

    // MOTOR UNIFICADO DE DATOS (Mismo fetch para Owner y Visitantes)
    useEffect(() => {
        const targetUid = viewMode === 'visiting' ? visitingUserId : currentUser?.uid;
        if (!targetUid) {
            if (viewMode === 'personal') setLoading(false);
            return;
        }

        setLoading(true);
        setDbError('');
        
        const banksRef = collection(db, 'users', targetUid, 'banks');
        const unsubBanks = onSnapshot(banksRef, (snapshot) => {
            setBanks(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })));
        }, (error) => {
            console.error("Error en Firebase (Bancos):", error);
            setDbError('Firebase ha bloqueado el acceso. Asegúrate de haber actualizado las Reglas de Firestore.');
            setLoading(false);
        });

        const balancesRef = collection(db, 'users', targetUid, 'balances');
        const unsubBalances = onSnapshot(balancesRef, (snapshot) => {
            setBalances(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })));
        }, (error) => console.error(error));

        const betsRef = collection(db, 'users', targetUid, 'bets');
        const unsubBets = onSnapshot(betsRef, (snapshot) => {
            setBets(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })));
            setLoading(false);
        }, (error) => { 
            console.error("Error en Firebase (Apuestas):", error); 
            setDbError('Firebase ha bloqueado el acceso a las apuestas.');
            setLoading(false); 
        });

        const prefsRef = doc(db, 'users', targetUid, 'preferences', 'customOptions');
        const unsubPrefs = onSnapshot(prefsRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                if (!data.sports || data.sports.length === 0) setCustomOptions({ ...data, sports: ['Fútbol', 'Baloncesto', 'Tenis', 'Esports'] });
                else setCustomOptions(data);
            } else {
                setCustomOptions({ sports: ['Fútbol', 'Baloncesto', 'Tenis', 'Esports'], categories: [] });
            }
        }, (error) => console.error("Error preferencias:", error));

        return () => { unsubBanks(); unsubBets(); unsubPrefs(); unsubBalances(); };
    }, [currentUser, viewMode, visitingUserId]);

    // Memoria del último banco visitado (Solo para Owner)
    useEffect(() => {
        if (viewMode === 'personal' && banks.length > 0 && !currentBankId) {
            const lastSavedId = localStorage.getItem(`moneytracking_last_bank_${currentUser?.uid}`);
            if (lastSavedId && (banks.find(b => b.id === lastSavedId) || balances.find(b => b.id === lastSavedId))) {
                setCurrentBankId(lastSavedId);
            } else {
                setCurrentBankId(banks[0].id);
            }
        }
    }, [banks, balances, currentBankId, currentUser, viewMode]);

    const handleBankChange = (e) => {
        const newId = e.target.value;
        setCurrentBankId(newId);
        if (currentUser) {
            localStorage.setItem(`moneytracking_last_bank_${currentUser.uid}`, newId);
        }
    };

    // Inteligencia para resolver si la ID pertenece a un Banco o a un Balance Agrupado
    const activeBankData = useMemo(() => {
        const idToFind = viewMode === 'visiting' ? visitingBankId : currentBankId;
        if (!idToFind) return null;
        
        const normalBank = banks.find(b => b.id === idToFind);
        if (normalBank) return normalBank;

        const balanceGroup = balances.find(b => b.id === idToFind);
        if (balanceGroup) {
            const includedBanks = banks.filter(b => balanceGroup.bankIds.includes(b.id));
            const totalCapital = includedBanks.reduce((sum, b) => sum + (parseFloat(b.initialCapital) || 0), 0);
            return {
                id: balanceGroup.id,
                name: `[Balance] ${balanceGroup.name}`,
                initialCapital: totalCapital,
                currency: includedBanks[0]?.currency || 'EUR',
                isBalance: true,
                bankIds: balanceGroup.bankIds,
                premiumPassword: balanceGroup.premiumPassword || ''
            };
        }
        return null;
    }, [banks, balances, currentBankId, viewMode, visitingBankId]);

    const activeBetsData = useMemo(() => {
        if (!activeBankData) return [];
        
        let rawBets = [];
        if (activeBankData.isBalance) {
            rawBets = bets.filter(b => activeBankData.bankIds.includes(b.bankId));
        } else {
            rawBets = bets.filter(b => b.bankId === activeBankData.id);
        }

        rawBets = rawBets.sort((a, b) => new Date(`${b.date}T${b.time || '00:00'}`) - new Date(`${a.date}T${a.time || '00:00'}`));

        if (viewMode === 'visiting') {
            if (activeBankData.premiumPassword && unlockedBank) return rawBets;
            return rawBets.filter(b => b.status !== 'pending');
        }
        
        return rawBets; 
    }, [bets, activeBankData, viewMode, unlockedBank]);

    const pendingHiddenCount = useMemo(() => {
        if (viewMode !== 'visiting' || !activeBankData) return 0;
        let targetBets = bets;
        if (activeBankData.isBalance) {
            targetBets = bets.filter(b => activeBankData.bankIds.includes(b.bankId));
        } else {
            targetBets = bets.filter(b => b.bankId === activeBankData.id);
        }
        return targetBets.filter(b => b.status === 'pending').length;
    }, [bets, activeBankData, viewMode]);

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
            setViewMode('personal'); setVisitingUserId(null); setVisitingBankId(null);
        }
    };

    const showAlert = (message) => setFeedbackModal({ isOpen: true, type: 'alert', message, onConfirm: null });
    const showConfirm = (message, onConfirm) => setFeedbackModal({ isOpen: true, type: 'confirm', message, onConfirm });
    const closeFeedbackModal = () => {
        if (!isProcessing) {
            setFeedbackModal(prev => ({ ...prev, isOpen: false }));
        }
    };

    // NUEVO: Motor Unificado de Modales de Distribución
    const openShareModalFor = (targetData) => {
        if(!targetData || !targetData.id) return showAlert("Selecciona una banca o balance válido.");
        
        const shareStr = btoa(`${currentUser.uid}|${targetData.id}`);
        let currentDomain = window.location.origin + window.location.pathname;
        const link = `${currentDomain}?s=${shareStr}`;
        const iframeCode = `<iframe src="${link}&embed=true" width="100%" height="700" style="border:none; border-radius: 16px; overflow:hidden; background: transparent;"></iframe>`;
        setShareModal({ isOpen: true, link, iframe: iframeCode });
    };

    const copyToClipboard = (text, msg) => {
        const el = document.createElement('textarea'); 
        el.value = text; 
        document.body.appendChild(el); 
        el.select(); 
        document.execCommand('copy'); 
        document.body.removeChild(el);
        showAlert(msg || "¡Copiado al portapapeles!");
    };

    const handleExitVisiting = () => {
        try { window.history.replaceState({}, document.title, window.location.pathname); } catch(e) {}
        setViewMode('personal'); 
        setVisitingUserId(null); 
        setVisitingBankId(null);
        setUnlockedBank(false);
    };

    const handleAmountChange = (val, type) => {
        const num = parseFloat(val) || 0; const cap = parseFloat(activeBankData?.initialCapital || 1000);
        if (type === 'amount') setNewBet(prev => ({ ...prev, amount: num, stake: ((num/cap)*100).toFixed(2) }));
        else setNewBet(prev => ({ ...prev, stake: num, amount: ((num/100)*cap).toFixed(2) }));
    };

    const handleSaveBet = async (e) => {
        e.preventDefault(); if (viewMode === 'visiting') return; 
        if (!newBet.amount) return showAlert("Introduce un importe válido."); if (!currentBankId) return showAlert("Crea una banca primero.");
        if (activeBankData?.isBalance) return showAlert("No puedes añadir apuestas en una vista de Balance Agrupado. Selecciona una banca individual.");
        if (!editingBetId && currentBets.length >= LIMITS.MAX_BETS_PER_BANK) { return showAlert(`Límite de ${LIMITS.MAX_BETS_PER_BANK} apuestas por banca alcanzado.`); }
        
        const totalOdds = newBet.selections.reduce((acc, s) => acc * (parseFloat(s.odds)||1), 1);
        const betData = { ...newBet, odds: parseFloat(totalOdds.toFixed(2)), amount: parseFloat(newBet.amount), bankId: currentBankId, createdAt: new Date().toISOString() };
        
        try {
            if (editingBetId) {
                await updateDoc(doc(db, 'users', currentUser.uid, 'bets', editingBetId), betData);
            } else {
                await addDoc(collection(db, 'users', currentUser.uid, 'bets'), betData);
            }
            setShowBetForm(false); setEditingBetId(null); setIsCustomBookmaker(false); setAiMessage('');
            setNewBet({ date: new Date().toISOString().split('T')[0], time: '00:00', bookmaker: 'Bet365', betMode: 'simple', title: '', selections: [{ id: Date.now(), title: '', selection: '', sport: customOptions.sports?.[0] || 'Fútbol', status: 'pending', category: '', odds: 1.50, isOpen: true }], amount: 0, stake: 0, analysis: '' });
        } catch (error) {
            console.error("Error guardando apuesta:", error);
            showAlert("Error guardando apuesta.");
        }
    };

    const handleImportCSV = async (event) => {
        if (viewMode === 'visiting') return showAlert("No puedes importar datos.");
        const file = event.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            const allRows = parseComplexCSV(e.target.result);
            const dataRows = (allRows.length > 0 && allRows[0][0] && allRows[0][0].replace(/"/g, '') === 'Date') ? allRows.slice(1) : allRows;
            if (dataRows.length === 0) return showAlert("Archivo vacío o no válido.");
            const validNewRows = dataRows.filter(cols => cols && cols.length >= 2 && cols[0]);
            let newBets = []; let currentBet = null;
            const batch = writeBatch(db);
            const betsCollection = collection(db, 'users', currentUser.uid, 'bets');

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
                setIsProcessing(true);
                newBets.forEach(b => {
                    const newDocRef = doc(betsCollection);
                    batch.set(newDocRef, b);
                });
                await batch.commit();
                showAlert(`¡Importado con éxito! Añadidas ${newBets.length} apuestas a la nube.`);
            } catch(error) {
                console.error(error); showAlert("Hubo algún error procesando algunos datos de tu Excel.");
            } finally {
                setIsProcessing(false);
            }
        };
        reader.readAsText(file); event.target.value = null;
    };

    const handleExportCSV = () => {
        if (!activeBetsData.length) return showAlert("No hay datos en esta banca para exportar.");
        const header = `"Date";"Type";"Sport";"Label";"Odds";"Stake";"State";"Bookmaker";"Tipster";"Category";"Competition";"BetType";"Closing";"Commission";"Bonus";"Live";"Freebet";"Cashout";"Eachway";"Comment"`;
        const rows = activeBetsData.map(b => {
            const statusMap = { 'won': 'W', 'lost': 'L', 'void': 'V', 'pending': 'P', 'half-won': 'HW', 'half-lost': 'HL' }; const dateFull = `${b.date} ${b.time || '00:00'}`; const safeText = (txt) => txt ? txt.replace(/"/g, '""') : '';
            return `"${dateFull}";"${b.selections?.length > 1 ? 'Combined' : 'Simple'}";"${safeText(b.selections?.[0]?.sport || '')}";"${safeText(b.title)}";"${b.odds}";"${b.amount || 0}";"${statusMap[b.status] || 'P'}";"${safeText(b.bookmaker)}";"";"${safeText(b.category || b.selections?.[0]?.category || '')}";"";"${safeText(b.selection || b.selections?.[0]?.selection || '')}";"";"";"";"${b.isLive ? 'Yes' : 'No'}";"${b.isFreebet ? 'Yes' : 'No'}";"${b.cashout || ''}";"${b.isEachWay ? 'Yes' : 'No'}";"${safeText(b.analysis)}"`
        });
        const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([[header, ...rows].join("\n")], { type: 'text/csv;charset=utf-8;' })); link.setAttribute("download", `MoneyTracKING_Export_${new Date().toISOString().slice(0,10)}.csv`); document.body.appendChild(link); link.click(); document.body.removeChild(link);
    };

    const handleDeleteBet = (id) => { 
        if (viewMode === 'visiting') return;
        showConfirm('¿Estás seguro de que deseas eliminar esta operación de forma permanente?', async () => {
            setIsProcessing(true);
            try { 
                await deleteDoc(doc(db, 'users', currentUser.uid, 'bets', id)); 
                setFeedbackModal(prev => ({ ...prev, isOpen: false }));
            }
            catch(e) { 
                console.error("Error Firebase:", e); 
                showAlert(`Fallo en la nube: ${e.message}`); 
            } finally {
                setIsProcessing(false);
            }
        });
    };

    const handleQuickStatusChange = async (status) => { 
        if (viewMode === 'visiting' || !statusModalData) return;
        try {
            const betToUpdate = bets.find(b => b.id === statusModalData.id);
            if(betToUpdate) {
                const newSels = (betToUpdate.selections || []).map(s => ({...s, status}));
                await updateDoc(doc(db, 'users', currentUser.uid, 'bets', statusModalData.id), { status, selections: newSels });
            }
            setStatusModalData(null); 
        } catch(e) { console.error(e); }
    };

    const handleBookieChange = (e) => { const val=e.target.value; if(val==='Otra'){setIsCustomBookmaker(true);setNewBet(p=>({...p,bookmaker:''}))}else{setIsCustomBookmaker(false);setNewBet(p=>({...p,bookmaker:val}))}};
    
    const handleEditClick = (bet) => { 
        if (viewMode === 'visiting') return; 
        setIsCustomBookmaker(!COMMON_BOOKMAKERS.includes(bet.bookmaker || '')); 
        setEditingBetId(bet.id); 
        setFormErrors({}); 
        
        setNewBet({
            ...bet,
            date: bet.date || new Date().toISOString().split('T')[0],
            time: bet.time || '00:00',
            bookmaker: bet.bookmaker || 'Bet365',
            betMode: bet.betMode || 'simple',
            title: bet.title || '',
            selections: bet.selections?.length > 0 ? bet.selections : [{ 
                id: Date.now(), 
                title: bet.title || '', 
                selection: bet.selection || '', 
                sport: bet.sport || customOptions.sports?.[0] || 'Fútbol', 
                status: bet.status || 'pending', 
                category: bet.category || '', 
                odds: bet.odds || 1.50, 
                isOpen: true 
            }],
            amount: bet.amount || 0,
            stake: bet.stake || 0,
            analysis: bet.analysis || '',
            commission: bet.commission || '',
            bonus: bet.bonus || '',
            isLive: bet.isLive || false,
            isFreebet: bet.isFreebet || false,
            cashout: bet.cashout || '',
            isEachWay: bet.isEachWay || false,
            tipster: bet.tipster || 'Money Tips'
        }); 
        setShowBetForm(true); 
        setAiMessage(''); 
    };

    const handleAddSelection = () => setNewBet(p => ({...p, selections: [...p.selections, { id: Date.now(), title: '', selection: '', sport: customOptions.sports?.[0] || 'Fútbol', status: 'pending', category: '', odds: 1.50, isOpen: true }]}));
    const handleRemoveSelection = (id) => { if(newBet.selections.length > 1) setNewBet(p => ({ ...p, selections: p.selections.filter(s => s.id !== id) })); };
    const handleUpdateSelection = (id, f, v) => setNewBet(p => ({ ...p, selections: p.selections.map(s => s.id === id ? { ...s, [f]: v } : s) }));
    const toggleSelection = (id) => setNewBet(p => ({ ...p, selections: p.selections.map(s => s.id === id ? { ...s, isOpen: !s.isOpen } : s) }));

    const handleAddOption = async (type, value) => { 
        if (!value.trim() || viewMode === 'visiting') return;
        const currentList = customOptions[type] || [];
        if (currentList.includes(value.trim())) return showAlert("Esta etiqueta ya existe.");

        const newOptions = { ...customOptions, [type]: [...currentList, value.trim()] };
        setCustomOptions(newOptions); 

        if (type === 'sports') setNewCustomSport('');
        if (type === 'categories') setNewCustomCategory('');

        try {
            await setDoc(doc(db, 'users', currentUser.uid, 'preferences', 'customOptions'), newOptions, { merge: true });
        } catch (error) {
            console.error("Error guardando etiqueta:", error);
            showAlert("Hubo un pequeño error guardando en la nube, pero se ha añadido temporalmente.");
        }
    };

    const handleDeleteOption = async (type, value) => { 
        if (viewMode === 'visiting') return;
        const currentList = customOptions[type] || [];
        const newOptions = { ...customOptions, [type]: currentList.filter(item => item !== value) };
        setCustomOptions(newOptions); 

        try {
            await setDoc(doc(db, 'users', currentUser.uid, 'preferences', 'customOptions'), newOptions, { merge: true });
        } catch (error) {
            console.error("Error eliminando etiqueta:", error);
        }
    };
    
    const openAddBankModal = () => {
        if(banks.length >= LIMITS.MAX_BANKS) return showAlert(`Límite de ${LIMITS.MAX_BANKS} bancas individuales alcanzado.`);
        setNewBankData({ name: `Nueva Banca ${banks.length+1}`, initialCapital: 1000, currency: 'EUR', premiumPassword: '' }); setIsAddingBank(true);
    };

    const confirmAddBank = async (e) => {
        e.preventDefault();
        const newBank = { name: newBankData.name || `Nueva Banca ${banks.length+1}`, initialCapital: parseFloat(newBankData.initialCapital) || 1000, currency: newBankData.currency, premiumPassword: newBankData.premiumPassword || '', createdAt: new Date().toISOString(), isEditable: false };
        try { await addDoc(collection(db, 'users', currentUser.uid, 'banks'), newBank); setIsAddingBank(false); }
        catch(error) { console.error(error); showAlert("Error creando banca."); }
    };

    const handleUpdateBank = async (id, field, value) => {
        if(field === 'initialCapital') return; 
        try { await updateDoc(doc(db, 'users', currentUser.uid, 'banks', id), { [field]: value }); }
        catch(e) { console.error(e); }
    }

    const handleDeleteBank = (id) => {
        if (viewMode === 'visiting') return;
        showConfirm('¿Borrar banca? Se eliminarán todos sus datos y apuestas asociadas de forma irreversible.', async () => {
            setIsProcessing(true);
            try { 
                await deleteDoc(doc(db, 'users', currentUser.uid, 'banks', id)); 
                setFeedbackModal(prev => ({ ...prev, isOpen: false }));
            }
            catch(e) { 
                console.error("Error Firebase:", e); 
                showAlert(`Error borrando banca: ${e.message}`); 
            } finally {
                setIsProcessing(false);
            }
        });
    };

    const confirmAddBalance = async (e) => {
        e.preventDefault();
        try {
            await addDoc(collection(db, 'users', currentUser.uid, 'balances'), {
                name: newBalanceData.name,
                bankIds: newBalanceData.bankIds,
                premiumPassword: newBalanceData.premiumPassword || '',
                createdAt: new Date().toISOString()
            });
            setIsAddingBalance(false);
            setNewBalanceData({ name: '', bankIds: [], premiumPassword: '' });
            showAlert("Balance agrupado creado correctamente.");
        } catch (error) {
            console.error("Error creando balance:", error);
            showAlert("Error creando el balance.");
        }
    };

    const handleDeleteBalance = (id) => {
        showConfirm('¿Eliminar esta agrupación? Las bancas individuales no se verán afectadas.', async () => {
            try { 
                await deleteDoc(doc(db, 'users', currentUser.uid, 'balances', id)); 
                closeFeedbackModal();
                if (currentBankId === id) {
                    setCurrentBankId(banks[0]?.id || null);
                }
            }
            catch(e) { console.error(e); showAlert("Error borrando balance."); }
        });
    };

    const MobileMenuItem = ({ icon: Icon, label, tabId }) => (
        <button onClick={() => { setActiveTab(tabId); setIsMobileMenuOpen(false); }} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${activeTab === tabId ? 'bg-[var(--bg-overlay)] text-[var(--accent)] border border-[var(--border)] shadow-sm' : 'text-[var(--text-muted)] hover:bg-[var(--bg-overlay-hover)] hover:text-[var(--text-main)]'}`}><Icon size={18}/> {label}</button>
    );

    // =========================================================================
    // RENDERIZADO DEL WIDGET (MODO EMBEBIDO / IFRAME)
    // =========================================================================
    if (isEmbed && activeBankData) {
        return (
            <div className="h-screen flex flex-col bg-[var(--bg-base)] text-[var(--text-main)] font-sans overflow-hidden">
                <style>{getGlobalStyles(theme)}</style>
                <LiquidBackground theme={theme} />
                
                {/* Cabecera Minimalista para el Iframe */}
                <header className="flex justify-between items-center px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-card)]/80 backdrop-blur-xl z-20">
                    <div className="flex items-center gap-3">
                        <img src="/favicon.jpg" alt="Logo" className="w-7 h-7 rounded-lg shadow-sm" onerror="this.style.display='none'" />
                        <h1 className="font-bold text-base tracking-tight truncate max-w-[150px] sm:max-w-xs">{activeBankData.name}</h1>
                    </div>
                    <div className="flex gap-2 bg-[var(--bg-input)] p-1 rounded-lg border border-[var(--border)]">
                        <button onClick={() => setActiveTab('dashboard')} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${activeTab==='dashboard' ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}>Resumen</button>
                        <button onClick={() => setActiveTab('bets')} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${activeTab==='bets' ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}>Apuestas</button>
                    </div>
                </header>

                {/* Contenido del Widget */}
                <main className="flex-1 overflow-y-auto custom-scrollbar p-3 md:p-5 z-10 relative">
                    {/* Caja Privacidad por si tiene contraseña */}
                    {activeBankData?.premiumPassword && !unlockedBank && pendingHiddenCount > 0 && activeTab === 'bets' && (
                        <div className="bg-[var(--bg-card)] border border-[var(--border-strong)] rounded-2xl p-5 text-center shadow-sm mb-5">
                            <Lock size={24} className="text-[var(--text-muted)] mx-auto mb-2" />
                            <h4 className="text-sm font-bold text-[var(--text-main)] mb-2">Hay {pendingHiddenCount} apuestas ocultas</h4>
                            <p className="text-[var(--text-muted)] text-xs mb-4">Introduce la clave para ver las jugadas en curso.</p>
                            <div className="flex gap-2 max-w-xs mx-auto">
                                <input type="password" value={visitorPasswordInput} onChange={e=>setVisitorPasswordInput(e.target.value)} className="flex-1 bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--accent)]" placeholder="Contraseña..." />
                                <button onClick={() => { if(visitorPasswordInput === activeBankData.premiumPassword) setUnlockedBank(true); else alert('Clave incorrecta'); }} className="bg-[var(--accent)] text-[var(--accent-fg)] px-4 py-2 rounded-lg text-sm font-bold">Ver</button>
                            </div>
                        </div>
                    )}

                    {activeTab === 'dashboard' && (
                        <div className="space-y-4">
                            <div className="bg-[var(--bg-card)] rounded-2xl p-6 border border-[var(--border)] shadow-sm text-center">
                                <p className="text-[var(--accent)] text-xs font-bold mb-1 uppercase tracking-widest">Beneficio Total</p>
                                <h2 className="text-4xl font-extrabold text-[var(--text-main)] tracking-tight">{formatCurrency(stats.totalProfit, activeBankData?.currency)}</h2>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                <StatCard title="Picks" value={stats.picks} />
                                <StatCard title="Ganados" value={stats.won} colorClass="text-[var(--accent)]" />
                                <StatCard title="Perdidos" value={stats.lost} colorClass="text-[var(--red)]" />
                                <StatCard title="Yield" value={`${stats.yield.toFixed(2)}%`} colorClass={stats.yield >= 0 ? "text-[var(--accent)]" : "text-[var(--red)]"} />
                            </div>
                        </div>
                    )}

                    {activeTab === 'bets' && (
                        <div className="space-y-3">
                            {betsByMonth.map(g => (
                                <div key={g.id} className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl overflow-hidden shadow-sm">
                                    <div onClick={()=>toggleMonth(g.id)} className="flex items-center justify-between p-4 bg-[var(--bg-hover)] cursor-pointer border-b border-[var(--border)]">
                                        <div className="flex items-center gap-2">
                                            {expandedMonths[g.id]?<ChevronUp size={16} className="text-[var(--accent)]"/>:<ChevronDown size={16} className="text-[var(--text-muted)]"/>}
                                            <span className="font-bold text-[var(--text-main)] text-sm">{g.label}</span>
                                        </div>
                                        <div className={`px-2.5 py-1 rounded-md text-xs font-bold ${g.profit>=0?'bg-[var(--accent-10)] text-[var(--accent)]':'bg-[var(--red-10)] text-[var(--red)]'}`}>{g.profit>0?'+':''}{formatCurrency(g.profit, activeBankData?.currency)}</div>
                                    </div>
                                    {expandedMonths[g.id] && (
                                        <div className="divide-y divide-[var(--border)]">
                                            {g.bets.map(b => {
                                                const amt=b.amount?parseFloat(b.amount):parseFloat(b.stake)*10;
                                                const pl=b.status==='won'?(amt*b.odds)-amt:b.status==='lost'?-amt:0;
                                                return (
                                                    <div key={b.id} className="p-3 text-sm hover:bg-[var(--bg-overlay)] transition-colors">
                                                        <div className="flex justify-between items-start mb-1">
                                                            <div className="font-bold text-[var(--text-main)] truncate max-w-[60%]">{b.title}</div>
                                                            <div className="font-bold text-[var(--accent)]">@{b.odds.toFixed(2)}</div>
                                                        </div>
                                                        <div className="flex justify-between items-center text-xs">
                                                            <div className="text-[var(--text-muted)]">{typeof b.selection==='string'?b.selection:'Múltiple'}</div>
                                                            <div className="flex items-center gap-2">
                                                                <span className={`font-bold ${pl>0?'text-[var(--accent)]':pl<0?'text-[var(--red)]':'text-[var(--text-muted)]'}`}>{pl>0?'+':''}{formatCurrency(pl,activeBankData?.currency)}</span>
                                                                <StatusBadge status={b.status} />
                                                            </div>
                                                        </div>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    )}
                                </div>
                            ))}
                            {activeBetsData.length === 0 && <p className="text-center text-sm text-[var(--text-muted)] p-8">No hay historial visible.</p>}
                        </div>
                    )}
                </main>

                {/* Footer "Caballo de Troya" */}
                <a href={window.location.origin} target="_blank" rel="noopener noreferrer" className="block text-center py-2 bg-[var(--bg-card)] border-t border-[var(--border)] text-[10px] font-bold text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors uppercase tracking-widest z-20">
                    ⚡ Powered by MoneyTracKING
                </a>
            </div>
        );
    }
    // =========================================================================
    // FIN RENDERIZADO WIDGET
    // =========================================================================

    if (!currentUser && viewMode === 'personal') {
        return (
            <><style>{getGlobalStyles(theme)}</style>
            <LiquidBackground theme={theme} />
            <div className="min-h-screen relative flex items-center justify-center p-4">
                <div className="bg-[var(--bg-base-95)] backdrop-blur-2xl p-8 rounded-[2rem] border border-[var(--border)] shadow-[var(--shadow-glow-lg)] w-full max-w-[400px] animate-in fade-in transition-colors">
                    <div className="flex justify-center mb-6">
                        <img src="/favicon.jpg" alt="MoneyTrackING Logo" className="w-20 h-20 rounded-full object-cover shadow-inner border border-[var(--border)]" />
                    </div>
                    <h1 className="text-3xl font-extrabold text-center text-[var(--text-main)] mb-2 tracking-tight">MoneyTrac<span className="text-[var(--yellow)]">KING</span></h1>
                    <p className="text-[var(--text-muted)] text-center text-sm mb-8 font-medium">Tu gestor de bankroll nivel Dios</p>
                    <div className="flex bg-[var(--bg-input)] p-1.5 rounded-2xl mb-8 border border-[var(--border)] transition-colors"><button type="button" onClick={() => setIsRegistering(false)} className={`flex-1 py-3 text-xs font-bold rounded-xl transition-all uppercase tracking-wider ${!isRegistering ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-[var(--shadow-glow-md)]' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}>Entrar</button><button type="button" onClick={() => setIsRegistering(true)} className={`flex-1 py-3 text-xs font-bold rounded-xl transition-all uppercase tracking-wider ${isRegistering ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-[var(--shadow-glow-md)]' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}>Registrarse</button></div>
                    <form onSubmit={handleAuth} className="space-y-4">
                        <div><input type="email" placeholder="Email" className="w-full bg-[var(--bg-input)] border border-transparent rounded-xl px-5 py-4 text-[var(--text-main)] focus:border-[var(--accent-50)] outline-none transition-all placeholder-[var(--text-muted)] font-medium text-sm shadow-inner" value={email} onChange={e => setEmail(e.target.value)} autoFocus required /></div>
                        <div><input type="password" placeholder="Contraseña" className="w-full bg-[var(--bg-input)] border border-transparent rounded-xl px-5 py-4 text-[var(--text-main)] focus:border-[var(--accent-50)] outline-none transition-all placeholder-[var(--text-muted)] font-medium text-sm shadow-inner" value={password} onChange={e => setPassword(e.target.value)} required /></div>
                        {authError && <p className="text-[var(--red)] text-xs text-center bg-[var(--red-10)] py-2 rounded-lg border border-[var(--red-20)]">{authError}</p>}
                        <button type="submit" className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-extrabold py-4 rounded-xl transition-all shadow-[var(--shadow-glow-md)] hover:shadow-[var(--shadow-glow-lg)] mt-2 uppercase tracking-widest text-sm">{isRegistering ? 'Crear Cuenta' : 'Iniciar Sesión'}</button>
                    </form>
                </div>
            </div></>
        );
    }

    if (loading && viewMode === 'personal') return <><style>{getGlobalStyles(theme)}</style><LiquidBackground theme={theme}/><div className="min-h-screen flex items-center justify-center text-[var(--accent)] animate-pulse font-bold text-xl drop-shadow-md">Conectando con la nube...</div></>;

    if (viewMode === 'visiting' && !loading && !activeBankData) {
        return (
            <><style>{getGlobalStyles(theme)}</style>
            <LiquidBackground theme={theme}/>
            <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
                <div className="bg-[var(--bg-card)] p-8 rounded-3xl border border-[var(--border)] shadow-[var(--shadow-glow-md)] max-w-md w-full animate-in fade-in">
                    <AlertTriangle size={48} className="text-[var(--text-muted)] mx-auto mb-4 drop-shadow-sm" />
                    <h2 className="text-2xl font-bold text-[var(--text-main)] mb-2 tracking-tight">Banca o Balance no encontrado</h2>
                    <p className="text-[var(--text-muted)] mb-6 text-sm leading-relaxed">El enlace es inválido o el usuario ha eliminado el acceso a esta cuenta.</p>
                    <button onClick={handleExitVisiting} className="w-full bg-[var(--accent)] text-[var(--accent-fg)] px-6 py-3 rounded-xl font-bold hover:opacity-90 transition-opacity shadow-[var(--shadow-glow-sm)]">Ir al Inicio</button>
                </div>
            </div></>
        )
    }

    if (dbError && viewMode === 'personal') return (
        <><style>{getGlobalStyles(theme)}</style>
        <LiquidBackground theme={theme}/>
        <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
            <div className="bg-[var(--bg-card)] p-8 rounded-3xl border border-[var(--red-30)] shadow-[var(--shadow-red)] max-w-md w-full animate-in fade-in">
                <AlertTriangle size={48} className="text-[var(--red)] mx-auto mb-4 drop-shadow-sm" />
                <h2 className="text-2xl font-bold text-[var(--text-main)] mb-2 tracking-tight">Conexión Bloqueada</h2>
                <p className="text-[var(--text-muted)] mb-6 text-sm leading-relaxed">{dbError}</p>
                <button onClick={handleLogout} className="w-full bg-[var(--bg-input)] border border-[var(--border)] px-6 py-3 rounded-xl font-bold text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors">Cerrar Sesión</button>
            </div>
        </div></>
    );

    if (banks.length === 0 && viewMode === 'personal') {
        return (
            <><style>{getGlobalStyles(theme)}</style>
            <LiquidBackground theme={theme} />
            <div className="flex flex-col md:flex-row h-screen text-[var(--text-main)] font-sans overflow-hidden">
                <aside className="hidden md:flex flex-col w-64 bg-[var(--bg-card)]/80 backdrop-blur-2xl border-r border-[var(--border)] transition-colors">
                    <div className="p-6 border-b border-[var(--border)] flex items-center gap-3">
                        <img src="/favicon.jpg" alt="Logo" className="w-8 h-8 rounded-lg object-cover shadow-[var(--shadow-glow-sm)]" />
                        <h1 className="font-bold text-lg tracking-tight">MoneyTrac<span className="text-[var(--yellow)]">KING</span></h1>
                    </div>
                    <div className="flex-1 p-4 flex flex-col justify-end"><div className="p-4 border-t border-[var(--border)]"><div className="flex items-center justify-between mb-2"><div className="flex items-center gap-2"><div className="w-8 h-8 rounded-full bg-[var(--accent)] flex items-center justify-center text-xs font-bold text-[var(--accent-fg)] shadow-[var(--shadow-glow-sm)]">{currentUser.email?.charAt(0).toUpperCase()}</div><div className="text-sm font-medium text-[var(--text-main)] max-w-[100px] truncate">{currentUser.email?.split('@')[0]}</div></div><button onClick={handleLogout} className="text-[var(--text-muted)] hover:text-[var(--red)]"><LogOut size={16}/></button></div></div></div>
                </aside>
                <main className="flex-1 flex flex-col items-center justify-center p-6 text-center">
                    <div className="bg-[var(--bg-card)] backdrop-blur-2xl p-8 rounded-3xl border border-[var(--border)] shadow-[var(--shadow-glow-md)] max-w-lg w-full transition-colors">
                        <div className="w-16 h-16 bg-[var(--bg-overlay)] border border-[var(--border)] rounded-full flex items-center justify-center mx-auto mb-6"><Plus size={32} className="text-[var(--accent)] drop-shadow-md" /></div>
                        <h2 className="text-3xl font-bold text-[var(--text-main)] mb-3">¡Bienvenido a la cima!</h2>
                        <p className="text-[var(--text-muted)] mb-8 leading-relaxed">Tus datos ahora están seguros en la nube. Configura tu primera banca para empezar a trackear como un profesional.</p>
                        <button onClick={openAddBankModal} className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold py-3.5 px-8 rounded-xl transition-all shadow-[var(--shadow-glow-md)] hover:shadow-[var(--shadow-glow-lg)] w-full flex items-center justify-center gap-2"><Plus size={20}/> Crear mi Primera Banca</button>
                    </div>
                </main>
                
                {isAddingBank && (
                    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-[var(--bg-modal)] backdrop-blur-md animate-in fade-in">
                        <div className="bg-[var(--bg-base-95)] backdrop-blur-2xl w-full max-w-sm rounded-3xl shadow-[var(--shadow-glow-lg)] border border-[var(--accent-20)] overflow-hidden flex flex-col transition-colors">
                            <div className="px-5 py-4 border-b border-[var(--border)] flex justify-between items-center bg-[var(--bg-card)]"><h3 className="font-bold text-[var(--text-main)] text-lg">Nueva Banca</h3><button onClick={() => setIsAddingBank(false)} className="text-[var(--text-muted)] hover:text-[var(--text-main)] bg-[var(--bg-overlay)] p-1.5 rounded-full"><X size={18}/></button></div>
                            <div className="p-6 space-y-5">
                                <div className="space-y-1.5"><label className="text-xs text-[var(--text-muted)] uppercase font-bold tracking-wider ml-1">Nombre</label><input type="text" placeholder="Ej: Bet365 Principal" className="w-full bg-[var(--bg-card)] border border-transparent rounded-xl px-4 py-3 text-[var(--text-main)] focus:border-[var(--accent-50)] shadow-inner outline-none transition-colors" value={newBankData.name} onChange={e => setNewBankData({...newBankData, name: e.target.value})} autoFocus /></div>
                                <div className="space-y-1.5"><label className="text-xs text-[var(--text-muted)] uppercase font-bold tracking-wider ml-1 flex items-center gap-2">Capital Inicial</label><input type="number" placeholder="1000" className="w-full bg-[var(--bg-card)] border border-transparent rounded-xl px-4 py-3 text-[var(--text-main)] focus:border-[var(--accent-50)] shadow-inner outline-none transition-colors" value={newBankData.initialCapital} onChange={e => setNewBankData({...newBankData, initialCapital: e.target.value})} /></div>
                                <div className="space-y-1.5"><label className="text-xs text-[var(--text-muted)] uppercase font-bold tracking-wider ml-1">Divisa</label><select className="w-full bg-[var(--bg-card)] border border-transparent rounded-xl px-4 py-3 text-[var(--text-main)] focus:border-[var(--accent-50)] shadow-inner outline-none transition-colors appearance-none" value={newBankData.currency} onChange={e => setNewBankData({...newBankData, currency: e.target.value})}><option value="EUR">EUR (€)</option><option value="USD">USD ($)</option><option value="GBP">GBP (£)</option><option value="MXN">MXN ($)</option></select></div>
                                <button onClick={confirmAddBank} className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold py-3.5 rounded-xl transition-all shadow-[var(--shadow-glow-md)] mt-4">Crear Banca</button>
                            </div>
                        </div>
                    </div>
                )}

                {/* MODAL FEEDBACK PREMIUM (INCLUSO SI NO HAY BANCAS) */}
                {feedbackModal.isOpen && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[var(--bg-modal)] backdrop-blur-md animate-in fade-in">
                        <div className="bg-[var(--bg-card)] backdrop-blur-2xl rounded-3xl shadow-[0_0_50px_rgba(0,0,0,0.3)] border border-[var(--border-strong)] p-8 w-full max-w-sm text-center transition-colors">
                            {feedbackModal.type === 'alert' ? (
                                <AlertTriangle size={48} className="text-[var(--accent)] mx-auto mb-4 drop-shadow-md" />
                            ) : (
                                <AlertTriangle size={48} className="text-[var(--yellow)] mx-auto mb-4 drop-shadow-md" />
                            )}
                            <h3 className="text-[var(--text-main)] font-extrabold text-xl mb-2 tracking-tight">
                                {feedbackModal.type === 'alert' ? 'Aviso' : 'Confirmación'}
                            </h3>
                            <p className="text-[var(--text-muted)] text-sm mb-6 whitespace-pre-wrap">{feedbackModal.message}</p>
                            <div className="flex gap-3 justify-center">
                                {feedbackModal.type === 'confirm' && (
                                    <button 
                                        onClick={closeFeedbackModal} 
                                        disabled={isProcessing}
                                        className="flex-1 py-3 bg-[var(--bg-input)] text-[var(--text-main)] border border-[var(--border)] rounded-xl font-bold hover:bg-[var(--bg-hover)] transition-all disabled:opacity-50"
                                    >
                                        Cancelar
                                    </button>
                                )}
                                <button 
                                    onClick={async () => { 
                                        if (feedbackModal.type === 'confirm' && feedbackModal.onConfirm) { 
                                            await feedbackModal.onConfirm(); 
                                        } else {
                                            closeFeedbackModal(); 
                                        }
                                    }} 
                                    disabled={isProcessing}
                                    className="flex-1 py-3 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] rounded-xl font-bold shadow-[var(--shadow-glow-md)] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                                >
                                    {isProcessing ? (
                                        <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> Procesando...</>
                                    ) : (
                                        'Aceptar'
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div></>
        );
    }

    return (
        <><style>{getGlobalStyles(theme)}</style>
        <LiquidBackground theme={theme} />
        <div className="flex flex-col md:flex-row h-screen text-[var(--text-main)] font-sans overflow-hidden">
            {isMobileMenuOpen && (
                <div className="fixed inset-0 z-50 bg-[var(--bg-modal)] backdrop-blur-md md:hidden animate-in fade-in" onClick={() => setIsMobileMenuOpen(false)}>
                    <div className="absolute top-0 left-0 bottom-0 w-64 bg-[var(--bg-base-95)] backdrop-blur-2xl p-4 shadow-2xl border-r border-[var(--accent-20)] slide-in transition-colors" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-6"><h2 className="font-bold text-lg text-[var(--text-main)]">Menú</h2><button onClick={() => setIsMobileMenuOpen(false)} className="p-1.5 rounded-full bg-[var(--bg-overlay)] hover:bg-[var(--bg-overlay-hover)] text-[var(--text-muted)]"><X size={18}/></button></div>
                        <nav className="space-y-2">
                            <MobileMenuItem icon={LayoutDashboard} label="Dashboard" tabId="dashboard" />
                            <MobileMenuItem icon={List} label="Mis Apuestas" tabId="bets" />
                            <MobileMenuItem icon={Layers} label="Balances" tabId="balances" />
                            <div className="pt-6 pb-2 px-4 text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Configuración</div>
                            <MobileMenuItem icon={Settings} label="Configuración" tabId="settings" />
                            <MobileMenuItem icon={Tags} label="Personalización" tabId="customization" />
                        </nav>
                    </div>
                </div>
            )}

            <aside className={`hidden md:flex flex-col w-64 bg-[var(--bg-card)]/50 backdrop-blur-2xl border-r border-[var(--border)] transition-colors`}>
                <div className="p-6 border-b border-[var(--border)] flex items-center gap-3">
                    <img src="/favicon.jpg" alt="Logo" className="w-8 h-8 rounded-lg object-cover shadow-[var(--shadow-glow-sm)]" />
                    <h1 className="font-bold text-lg tracking-tight text-[var(--text-main)]">MoneyTrac<span className="text-[var(--yellow)] drop-shadow-sm">KING</span></h1>
                </div>
                {viewMode === 'visiting' ? (
                    <div className="flex-1 flex flex-col p-4 bg-indigo-500/5">
                        <div className="mb-4 p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl backdrop-blur-md">
                            <p className="text-[10px] text-indigo-500 dark:text-indigo-300 uppercase font-bold mb-1 flex items-center gap-2"><Eye size={12}/> Modo Visitante</p>
                            {/* AQUÍ ESTABA EL ERROR: CAMBIAMOS visitingBank POR activeBankData */}
                            <p className="text-[var(--text-main)] text-sm font-bold truncate drop-shadow-sm">{activeBankData?.name}</p>
                        </div>
                        <nav className="space-y-2"><button onClick={() => setActiveTab('dashboard')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${activeTab === 'dashboard' ? 'bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 border border-indigo-500/30 shadow-lg' : 'text-[var(--text-muted)] hover:bg-[var(--bg-overlay)] hover:text-[var(--text-main)]'}`}><LayoutDashboard size={18}/> Dashboard</button><button onClick={() => setActiveTab('bets')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${activeTab === 'bets' ? 'bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 border border-indigo-500/30 shadow-lg' : 'text-[var(--text-muted)] hover:bg-[var(--bg-overlay)] hover:text-[var(--text-main)]'}`}><List size={18}/> Historial</button></nav>
                        <div className="mt-auto"><button onClick={handleExitVisiting} className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold text-[var(--text-main)] bg-[var(--bg-overlay)] border border-[var(--border)] hover:bg-[var(--bg-overlay-hover)] transition-all backdrop-blur-md"><LogOut size={16}/> {currentUser ? 'Volver a mi Banca' : 'Ir al Inicio de Sesión'}</button></div>
                    </div>
                ) : (
                    <><nav className="p-4 space-y-2 flex-1">
                        <button onClick={() => setActiveTab('dashboard')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${activeTab === 'dashboard' ? 'bg-[var(--bg-overlay)] text-[var(--accent)] border border-[var(--border)] shadow-sm' : 'text-[var(--text-muted)] hover:bg-[var(--bg-overlay-hover)] hover:text-[var(--text-main)]'}`}><LayoutDashboard size={18}/> Dashboard</button>
                        <button onClick={() => setActiveTab('bets')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${activeTab === 'bets' ? 'bg-[var(--bg-overlay)] text-[var(--accent)] border border-[var(--border)] shadow-sm' : 'text-[var(--text-muted)] hover:bg-[var(--bg-overlay-hover)] hover:text-[var(--text-main)]'}`}><List size={18}/> Mis Apuestas</button>
                        <button onClick={() => setActiveTab('balances')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${activeTab === 'balances' ? 'bg-[var(--bg-overlay)] text-[var(--accent)] border border-[var(--border)] shadow-sm' : 'text-[var(--text-muted)] hover:bg-[var(--bg-overlay-hover)] hover:text-[var(--text-main)]'}`}><Layers size={18}/> Balances</button>
                        <div className="pt-6 pb-2 px-4 text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Configuración</div>
                        <button onClick={() => setActiveTab('settings')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${activeTab === 'settings' ? 'bg-[var(--bg-overlay)] text-[var(--accent)] border border-[var(--border)] shadow-sm' : 'text-[var(--text-muted)] hover:bg-[var(--bg-overlay-hover)] hover:text-[var(--text-main)]'}`}><Settings size={18}/> Configuración</button>
                        <button onClick={() => setActiveTab('customization')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${activeTab === 'customization' ? 'bg-[var(--bg-overlay)] text-[var(--accent)] border border-[var(--border)] shadow-sm' : 'text-[var(--text-muted)] hover:bg-[var(--bg-overlay-hover)] hover:text-[var(--text-main)]'}`}><Tags size={18}/> Personalización</button>
                    </nav><div className="p-4 border-t border-[var(--border)]"><div className="flex items-center justify-between mb-2"><div className="flex items-center gap-2"><div className="w-8 h-8 rounded-full bg-[var(--accent)] flex items-center justify-center text-xs font-bold text-[var(--accent-fg)] shadow-[var(--shadow-glow-sm)]">{currentUser.email?.charAt(0).toUpperCase()}</div><div className="text-sm font-medium text-[var(--text-main)] max-w-[100px] truncate">{currentUser.email?.split('@')[0]}</div></div><button onClick={handleLogout} className="text-[var(--text-muted)] hover:text-[var(--red)] bg-[var(--bg-overlay)] p-1.5 rounded-full"><LogOut size={16}/></button></div><div className="text-center text-[10px] text-[var(--accent-80)] mt-3 font-medium"><ShieldCheck size={10} className="inline mr-1"/> Sincronizado en la nube</div></div></>
                )}
            </aside>

            <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative mb-16 md:mb-0">
                <header className="h-16 bg-transparent backdrop-blur-xl border-b border-[var(--border)] flex items-center justify-between px-6 sticky top-0 z-30 transition-colors">
                    <div className="flex items-center gap-4">
                        <button onClick={() => setIsMobileMenuOpen(true)} className="md:hidden p-2 rounded-xl bg-[var(--bg-overlay)] text-[var(--text-main)] hover:bg-[var(--bg-overlay-hover)] border border-[var(--border)]"><Menu size={20} /></button>
                        <h2 className="text-xl font-bold text-[var(--text-main)] tracking-tight">
                            {viewMode === 'visiting' 
                                ? <span className="text-indigo-500 dark:text-indigo-300 flex items-center gap-2 drop-shadow-sm"><Eye size={20}/> Visitando: {activeBankData?.name}</span> 
                                : (activeTab === 'dashboard' ? 'Panel de Control' : activeTab === 'bets' ? 'Mis Apuestas' : activeTab === 'customization' ? 'Personalización' : activeTab === 'balances' ? 'Balances' : 'Configuración')}
                        </h2>
                    </div>
                    <div className="flex items-center gap-3">
                        <button onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} className="p-2 rounded-xl bg-[var(--bg-overlay)] text-[var(--text-main)] hover:bg-[var(--bg-overlay-hover)] border border-[var(--border)] transition-colors shadow-sm" title="Alternar Tema">
                            {theme === 'dark' ? <Sun size={18} className="text-[var(--text-muted)] hover:text-white" /> : <Moon size={18} className="text-[var(--text-muted)] hover:text-[#0F172A]" />}
                        </button>
                        
                        {viewMode === 'personal' && (banks.length > 0 || balances.length > 0) && (
                            <div className="relative hidden sm:block">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><Wallet size={14} className="text-[var(--accent)] drop-shadow-sm"/></div>
                                <select value={currentBankId || ''} onChange={handleBankChange} className="appearance-none bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-main)] pl-9 pr-9 py-2 rounded-xl text-sm focus:outline-none focus:border-[var(--accent-50)] shadow-inner font-medium transition-colors hover:bg-[var(--bg-hover)] cursor-pointer max-w-[200px] truncate">
                                    <optgroup label="Bancas Individuales">
                                        {banks.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
                                    </optgroup>
                                    {balances.length > 0 && (
                                        <optgroup label="Balances Agrupados">
                                            {balances.map(b=><option key={b.id} value={b.id}>📊 {b.name}</option>)}
                                        </optgroup>
                                    )}
                                </select>
                                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" size={14}/>
                            </div>
                        )}
                        {viewMode === 'visiting' && (
                            <div className="bg-indigo-500/20 border border-indigo-500/30 px-3 py-1.5 rounded-lg text-xs text-indigo-600 dark:text-indigo-300 font-bold backdrop-blur-sm" title="Por privacidad, las apuestas pendientes están ocultas.">Modo Lectura</div>
                        )}
                    </div>
                </header>

                <div className="flex-1 overflow-auto p-4 md:p-6 space-y-6 custom-scrollbar relative z-10">
                {activeTab === 'dashboard' && activeBankData && (
                    <><div className="relative overflow-hidden bg-[var(--bg-card)] rounded-3xl p-8 md:p-10 border border-[var(--border)] shadow-md transition-colors">
                        <div className="absolute inset-0 bg-gradient-to-br from-[var(--bg-card)] to-[var(--bg-base)]"></div>
                        <div className="absolute inset-0 bg-gradient-to-r from-[var(--accent-5)] to-transparent"></div>
                        <div className="relative z-10 flex justify-between items-start">
                            <div><h3 className="text-[var(--accent)] text-sm font-bold mb-2 uppercase tracking-widest drop-shadow-sm">Beneficio Total ({activeBankData?.name})</h3><h1 className="text-5xl md:text-6xl font-extrabold text-[var(--text-main)] tracking-tight drop-shadow-lg">{formatCurrency(stats.totalProfit, activeBankData?.currency)}</h1></div>
                            {viewMode === 'personal' && !activeBankData.isBalance && (
                                <div className="flex gap-2">
                                    <button onClick={() => openShareModalFor(activeBankData)} className="bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] text-[var(--text-main)] px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all border border-[var(--border)] shadow-sm hover:border-[var(--accent-50)]"><Code size={16} className="text-[var(--accent)]"/> Insertar / Compartir</button>
                                </div>
                            )}
                        </div>
                        <div className="absolute right-0 bottom-0 opacity-5 transform translate-y-1/4 translate-x-1/4 pointer-events-none blur-sm"><Wallet size={200} /></div>
                    </div>
                    
                    <div className="bg-transparent"><div className="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4"><StatCard title="Picks" value={stats.picks} subValue="Total" /><StatCard title="Ganados" value={stats.won} colorClass="text-[var(--accent)]" /><StatCard title="U. APOSTADAS" value={formatUnits(stats.stakedUnits)} /><StatCard title="Beneficio/Día" value={formatCurrency(stats.profitDay, activeBankData?.currency)} colorClass={stats.profitDay >= 0 ? "text-[var(--accent)]" : "text-[var(--red)]"} /><StatCard title="Factor de Beneficio" value={stats.profitFactor.toFixed(2)} /><StatCard title="Tasa de Acierto" value={`${stats.winRate.toFixed(2)}%`} /><StatCard title="Perdidos" value={stats.lost} colorClass="text-[var(--red)]" /><StatCard title="U. GANADAS (NETO)" value={formatUnits(stats.profitUnits)} colorClass={stats.profitUnits >= 0 ? "text-[var(--accent)]" : "text-[var(--red)]"} /><StatCard title="Beneficio/Pick" value={formatCurrency(stats.profitPerPick, activeBankData?.currency)} colorClass={stats.profitPerPick >= 0 ? "text-[var(--accent)]" : "text-[var(--red)]"} /><StatCard title="Yield" value={`${stats.yield.toFixed(2)}%`} colorClass={stats.yield >= 0 ? "text-[var(--accent)]" : "text-[var(--red)]"} /></div></div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6"><div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-3xl p-6 h-72 flex flex-col relative shadow-sm transition-colors"><div className="flex justify-between items-center mb-6"><h4 className="text-xs text-[var(--text-muted)] uppercase font-bold tracking-wider">Evolución del Beneficio</h4><div className="flex bg-[var(--bg-input)] rounded-lg p-1 border border-[var(--border)] backdrop-blur-sm"><button onClick={() => setChartViewMode('detailed')} className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${chartViewMode==='detailed'?'bg-[var(--accent)] text-[var(--accent-fg)] shadow-[var(--shadow-glow-sm)]':'text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}><TrendingUp size={14}/></button><button onClick={() => setChartViewMode('weekly')} className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${chartViewMode==='weekly'?'bg-[var(--accent)] text-[var(--accent-fg)] shadow-[var(--shadow-glow-sm)]':'text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}><LineChart size={14}/></button></div></div><ResponsiveContainer width="100%" height="100%">{chartViewMode === 'detailed' ? (<AreaChart data={stats.detailedChart}><defs><linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={theme === 'dark' ? '#5EE6B1' : '#2563EB'} stopOpacity={0.4}/><stop offset="95%" stopColor={theme === 'dark' ? '#5EE6B1' : '#2563EB'} stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke={theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'} vertical={false}/><XAxis dataKey="name" stroke={theme === 'dark' ? '#64748b' : '#94a3b8'} tick={{fontSize:10, fill: theme === 'dark' ? '#64748b' : '#94a3b8'}} tickLine={false} axisLine={false}/><YAxis stroke={theme === 'dark' ? '#64748b' : '#94a3b8'} tick={{fontSize:10, fill: theme === 'dark' ? '#64748b' : '#94a3b8'}} tickLine={false} axisLine={false}/><Tooltip contentStyle={{backgroundColor: theme === 'dark' ? '#111621' : '#FFFFFF', border:`1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)'}`, borderRadius:'12px', color: theme === 'dark' ? 'white' : '#1E293B'}} itemStyle={{color: theme === 'dark' ? '#5EE6B1' : '#2563EB', fontWeight:'bold'}} formatter={(val)=>[formatCurrency(val,activeBankData?.currency), 'Beneficio']} /><Area type="monotone" dataKey="profit" stroke={theme === 'dark' ? '#5EE6B1' : '#2563EB'} strokeWidth={3} fill="url(#colorProfit)"/></AreaChart>) : (<ReLineChart data={stats.weeklyChart}><CartesianGrid strokeDasharray="3 3" stroke={theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'} vertical={false}/><XAxis dataKey="name" stroke={theme === 'dark' ? '#64748b' : '#94a3b8'} tick={{fontSize:10, fill: theme === 'dark' ? '#64748b' : '#94a3b8'}} tickLine={false} axisLine={false}/><YAxis stroke={theme === 'dark' ? '#64748b' : '#94a3b8'} tick={{fontSize:10, fill: theme === 'dark' ? '#64748b' : '#94a3b8'}} tickLine={false} axisLine={false}/><Tooltip contentStyle={{backgroundColor: theme === 'dark' ? '#111621' : '#FFFFFF', border:`1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)'}`, borderRadius:'12px', color: theme === 'dark' ? 'white' : '#1E293B'}} itemStyle={{color: theme === 'dark' ? '#5EE6B1' : '#2563EB', fontWeight:'bold'}} labelFormatter={(l, p) => p[0]?.payload?.fullLabel || l} formatter={(val)=>[formatCurrency(val,activeBankData?.currency), 'Beneficio']} /><Line type="linear" dataKey="profit" stroke={theme === 'dark' ? '#5EE6B1' : '#2563EB'} strokeWidth={3} dot={{r: 4, fill: theme === 'dark' ? '#5EE6B1' : '#2563EB', strokeWidth: 0}} activeDot={{r: 6, stroke: theme === 'dark' ? '#fff' : '#0F172A', strokeWidth: 2}}/></ReLineChart>)}</ResponsiveContainer></div><div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-3xl p-6 h-72 flex flex-col relative shadow-sm transition-colors"><div className="flex justify-between items-center mb-6"><h4 className="text-xs text-[var(--text-muted)] uppercase font-bold tracking-wider">Rendimiento Temporal</h4><div className="flex bg-[var(--bg-input)] rounded-lg p-1 border border-[var(--border)] backdrop-blur-sm"><button onClick={() => setBarChartViewMode('weekly')} className={`px-3 py-1 text-xs rounded-md font-medium flex items-center gap-1 transition-colors ${barChartViewMode==='weekly'?'bg-[var(--accent)] text-[var(--accent-fg)] shadow-[var(--shadow-glow-sm)]':'text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}><CalendarDays size={12}/> Semana</button><button onClick={() => setBarChartViewMode('monthly')} className={`px-3 py-1 text-xs rounded-md font-medium flex items-center gap-1 transition-colors ${barChartViewMode==='monthly'?'bg-[var(--accent)] text-[var(--accent-fg)] shadow-[var(--shadow-glow-sm)]':'text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}><Calendar size={12}/> Mes</button></div></div><ResponsiveContainer width="100%" height="100%"><BarChart data={barChartViewMode === 'weekly' ? stats.weeklyBarChart : stats.monthlyBarChart}><CartesianGrid strokeDasharray="3 3" stroke={theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'} vertical={false}/><XAxis dataKey="name" stroke={theme === 'dark' ? '#64748b' : '#94a3b8'} tick={{fontSize:10, fill: theme === 'dark' ? '#64748b' : '#94a3b8'}} tickLine={false} axisLine={false}/><YAxis stroke={theme === 'dark' ? '#64748b' : '#94a3b8'} tick={{fontSize:10, fill: theme === 'dark' ? '#64748b' : '#94a3b8'}} tickLine={false} axisLine={false}/><Tooltip contentStyle={{backgroundColor: theme === 'dark' ? '#111621' : '#FFFFFF', border:`1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)'}`, borderRadius:'12px', color: theme === 'dark' ? 'white' : '#1E293B'}} cursor={{fill: theme === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)'}} formatter={(val)=>[formatCurrency(val,activeBankData?.currency), 'Beneficio']}/><Bar dataKey="profit" radius={[6,6,0,0]}>{(barChartViewMode === 'weekly' ? stats.weeklyBarChart : stats.monthlyBarChart).map((e,i)=><Cell key={`c-${i}`} fill={e.profit>=0?(theme === 'dark' ? '#5EE6B1' : '#2563EB'):(theme === 'dark' ? '#FF5A5F' : '#EF4444')}/>)}</Bar></BarChart></ResponsiveContainer></div></div></>
                )}

                {activeTab === 'bets' && (
                    <div className="space-y-6">
                    <div className="flex justify-between items-center"><h3 className="text-2xl font-bold text-[var(--text-main)] tracking-tight drop-shadow-sm">{viewMode === 'visiting' ? 'Historial Público' : 'Mis Apuestas'}</h3>{viewMode === 'personal' && activeBankData && !activeBankData.isBalance && (<button onClick={() => { setEditingBetId(null); setShowBetForm(true); setFormErrors({}); setIsCustomBookmaker(false); setAiMessage(''); setNewBet({ date: new Date().toISOString().split('T')[0], time: '00:00', bookmaker: 'Bet365', betMode: 'simple', title: '', selections: [{ id: Date.now(), title: '', selection: '', sport: customOptions.sports?.[0] || 'Fútbol', status: 'pending', category: '', odds: 1.50, isOpen: true }], amount: 0, stake: 0, analysis: '' }); }} className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] px-5 py-2.5 rounded-xl flex items-center gap-2 font-bold text-sm transition-all shadow-[var(--shadow-glow-md)]"><Plus size={18}/> Añadir Apuesta</button>)}</div>
                    
                    {viewMode === 'visiting' && pendingHiddenCount > 0 && !unlockedBank && (
                        <div className="bg-[var(--bg-card)] border border-[var(--border-strong)] rounded-3xl p-6 text-center shadow-sm transition-colors animate-in fade-in">
                            <Lock size={32} className="text-[var(--text-muted)] mx-auto mb-3" />
                            <h4 className="text-lg font-extrabold text-[var(--text-main)] mb-2">
                                Hay {pendingHiddenCount} apuestas en curso bloqueadas
                            </h4>
                            {activeBankData?.premiumPassword ? (
                                <>
                                    <p className="text-[var(--text-muted)] text-sm mb-5">El autor ha protegido estas jugadas con contraseña. Introdúcela para poder verlas.</p>
                                    <div className="flex flex-col sm:flex-row gap-3 max-w-sm mx-auto">
                                        <input type="password" value={visitorPasswordInput} onChange={e=>setVisitorPasswordInput(e.target.value)} className="flex-1 bg-[var(--bg-input)] border border-[var(--border)] rounded-xl px-4 py-3 text-[var(--text-main)] outline-none focus:border-[var(--accent)] shadow-inner transition-colors" placeholder="Contraseña..." />
                                        <button onClick={() => { if(visitorPasswordInput === activeBankData.premiumPassword) { setUnlockedBank(true); showAlert('✅ Acceso Concedido'); } else { showAlert('Contraseña incorrecta'); } }} className="bg-[var(--accent)] text-[var(--accent-fg)] px-6 py-3 rounded-xl font-bold hover:bg-[var(--accent-hover)] transition-all shadow-md">Desbloquear</button>
                                    </div>
                                </>
                            ) : (
                                <p className="text-[var(--text-muted)] text-sm">El autor mantiene sus jugadas activas en privado hasta que se resuelven.</p>
                            )}
                        </div>
                    )}

                    {activeBetsData.length===0?<div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-3xl p-12 text-center text-[var(--text-muted)] text-sm shadow-sm transition-colors">El historial está vacío. {viewMode === 'personal' && !activeBankData?.isBalance ? 'Escanea un boleto o añade una apuesta para empezar a ver datos.' : ''}</div>:
                    <div className="space-y-5">
                        {betsByMonth.map(g=>(
                        <div key={g.id} className="border border-[var(--border)] rounded-2xl overflow-hidden bg-[var(--bg-card)] shadow-sm transition-colors">
                            <div onClick={()=>toggleMonth(g.id)} className="flex items-center justify-between p-5 bg-[var(--bg-hover)] cursor-pointer hover:bg-[var(--bg-overlay)] transition-all border-b border-[var(--border)]"><div className="flex items-center gap-3">{expandedMonths[g.id]?<ChevronUp size={20} className="text-[var(--accent)]"/>:<ChevronDown size={20} className="text-[var(--text-muted)]"/>}<span className="font-bold text-[var(--text-main)] text-base tracking-wide drop-shadow-sm">{g.label}</span></div><div className={`px-4 py-1.5 rounded-lg text-sm font-bold ${g.profit>=0?'bg-[var(--accent-10)] text-[var(--accent)] border border-[var(--accent-20)]':'bg-[var(--red-10)] text-[var(--red)] border border-[var(--red-20)]'}`}>{g.profit>0?'+':''}{formatCurrency(g.profit, activeBankData?.currency)}</div></div>
                            {expandedMonths[g.id]&&(
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left text-sm whitespace-nowrap">
                                        <thead className="bg-[var(--bg-base)]/50 text-[var(--text-muted)] text-xs uppercase tracking-widest font-semibold border-b border-[var(--border)]"><tr><th className="px-5 py-4">Fecha</th><th className="px-5 py-4">Evento</th><th className="px-5 py-4 text-center">Stake</th><th className="px-5 py-4 text-center">Cuota</th><th className="px-5 py-4 text-center">P/L</th><th className="px-5 py-4 text-center">Estado</th>{viewMode === 'personal' && <th className="px-5 py-4 text-center">Acciones</th>}</tr></thead>
                                        <tbody className="divide-y divide-[var(--border)]">
                                            {g.bets.map(b=>{
                                                const amt=b.amount?parseFloat(b.amount):parseFloat(b.stake)*10;const pl=b.status==='won'?(amt*b.odds)-amt:b.status==='lost'?-amt:0;const isExp=expandedBetId===b.id;
                                                return(
                                                    <React.Fragment key={b.id}>
                                                        <tr className={`hover:bg-[var(--bg-overlay)] cursor-pointer transition-colors ${isExp?'bg-[var(--bg-overlay-hover)]':''}`} onClick={()=>setExpandedBetId(isExp?null:b.id)}><td className="px-5 py-4 text-[var(--text-muted)] text-xs font-medium">{formatDate(b.date)}</td><td className="px-5 py-4"><div className="font-bold text-[var(--text-main)] max-w-[150px] md:max-w-xs truncate">{b.title}</div><div className="text-xs text-[var(--text-muted)] max-w-[150px] md:max-w-xs truncate mt-0.5">{typeof b.selection==='string'?b.selection:'Múltiple'}</div></td><td className="px-5 py-4 text-center text-[var(--text-muted)] font-medium">{b.stake}%</td><td className="px-5 py-4 text-center text-[var(--accent)] font-bold">@{b.odds.toFixed(2)}</td><td className={`px-5 py-4 text-center font-bold ${pl>0?'text-[var(--accent)]':pl<0?'text-[var(--red)]':'text-[var(--text-muted)]'}`}>{pl>0?'+':''}{formatCurrency(pl,activeBankData?.currency)}</td><td className="px-5 py-4 text-center"><div onClick={(e)=>{if(viewMode==='personal'){e.stopPropagation();setStatusModalData({id:b.id,currentStatus:b.status});}}} className={viewMode==='personal'?'cursor-pointer':''}><StatusBadge status={b.status}/></div></td>
                                                        {viewMode === 'personal' && <td className="px-5 py-4 text-center"><div className="flex items-center justify-center gap-2"><button onClick={(e)=>{e.stopPropagation();handleEditClick(b);}} className="text-[var(--text-muted)] hover:text-[var(--text-main)] p-2 rounded-lg bg-[var(--bg-overlay)] hover:bg-[var(--bg-overlay-hover)] transition-colors border border-transparent hover:border-[var(--border-strong)]"><Edit2 size={14}/></button><button onClick={(e)=>{e.stopPropagation();handleDeleteBet(b.id);}} className="text-[var(--text-muted)] hover:text-[var(--red)] p-2 rounded-lg bg-[var(--bg-overlay)] hover:bg-[var(--red-10)] transition-colors border border-transparent hover:border-[var(--red-20)]"><Trash2 size={14}/></button></div></td>}
                                                        </tr>
                                                        {isExp&&(<tr className="bg-[var(--bg-input)]/50"><td colSpan={viewMode==='personal'?7:6} className="p-5 border-b border-[var(--border)]"><div className="space-y-4"><div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs"><div className="p-4 bg-[var(--bg-card)] rounded-xl border border-[var(--border)] shadow-sm"><span className="block text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-1 font-bold">Casa</span><span className="text-[var(--text-main)] font-bold">{b.bookmaker}</span></div><div className="p-4 bg-[var(--bg-card)] rounded-xl border border-[var(--border)] shadow-sm"><span className="block text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-1 font-bold">Hora</span><span className="text-[var(--text-main)] font-bold">{b.time}</span></div>{b.commission&&<div className="p-4 bg-[var(--bg-card)] rounded-xl border border-[var(--border)] shadow-sm"><span className="block text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-1 font-bold">Comisión</span><span className="text-[var(--text-main)] font-bold">{b.commission}%</span></div>}</div>{b.selections&&b.selections.map((s,i)=>(<div key={i} className="bg-[var(--bg-card)] p-4 rounded-xl border border-[var(--border)] shadow-sm flex justify-between items-center hover:bg-[var(--bg-hover)] transition-colors"><div><div className="text-[var(--text-main)] text-sm font-bold tracking-wide">{s.title}</div><div className="text-[var(--accent)] text-xs font-medium mt-1">{s.selection}</div><div className="text-[10px] text-[var(--text-muted)] mt-1 uppercase tracking-wider">{s.competition} • {s.category}</div></div><div className="text-right"><div className="text-[var(--accent)] font-extrabold text-lg">@{parseFloat(s.odds).toFixed(2)}</div><div className="text-[var(--text-muted)] text-[10px] uppercase tracking-wider font-bold mt-1">{s.bookmaker}</div></div></div>))}{b.analysis&&(<div className="bg-[var(--accent-5)] p-4 rounded-xl border border-[var(--accent-20)]"><h4 className="text-[var(--accent)] font-bold mb-2 flex items-center gap-2 text-xs uppercase tracking-wider"><FileText size={14}/> Análisis</h4><p className="text-[var(--text-muted)] text-sm leading-relaxed whitespace-pre-wrap">{b.analysis}</p></div>)}</div></td></tr>)}
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

                {activeTab === 'balances' && viewMode === 'personal' && (
                    <div className="max-w-4xl mx-auto space-y-6 pb-20 md:pb-0">
                        <div className="flex justify-between items-center mb-2">
                            <div>
                                <h3 className="text-2xl font-bold text-[var(--text-main)] tracking-tight">Balances Agrupados</h3>
                                <p className="text-[var(--text-muted)] text-sm mt-1">Agrupa varios bankrolls para ver sus estadísticas globales juntas.</p>
                            </div>
                            <button onClick={() => { setNewBalanceData({ name: '', bankIds: [], premiumPassword: '' }); setIsAddingBalance(true); }} className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] px-4 py-2.5 rounded-xl flex items-center gap-2 text-sm font-bold transition-all shadow-[var(--shadow-glow-md)]">
                                <Plus size={16} /> Crear Balance
                            </button>
                        </div>

                        {balances.length === 0 ? (
                            <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-3xl p-12 text-center text-[var(--text-muted)] text-sm shadow-sm transition-colors">
                                No tienes balances agrupados. Crea uno para combinar las estadísticas de múltiples bancas.
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 gap-6">
                                {balances.map(balance => {
                                    const includedBanks = banks.filter(b => balance.bankIds.includes(b.id));
                                    const totalInitialCapital = includedBanks.reduce((sum, b) => sum + (parseFloat(b.initialCapital) || 0), 0);
                                    const balanceBets = bets.filter(b => balance.bankIds.includes(b.bankId));
                                    const bStats = getStatsForBets(balanceBets, totalInitialCapital);
                                    
                                    return (
                                        <div key={balance.id} className="bg-[var(--bg-card)] border border-[var(--border)] rounded-3xl p-6 shadow-sm transition-all hover:border-[var(--accent-50)] group">
                                            <div className="flex justify-between items-start mb-6">
                                                <div>
                                                    <h3 className="text-xl font-bold text-[var(--text-main)]">{balance.name}</h3>
                                                    <p className="text-sm text-[var(--text-muted)]">{balance.bankIds.length} Bankrolls</p>
                                                </div>
                                                <div className="flex gap-2">
                                                    <button onClick={() => { handleBankChange({target: {value: balance.id}}); setActiveTab('dashboard'); }} className="p-2 bg-[var(--accent-10)] text-[var(--accent)] rounded-lg hover:bg-[var(--accent-20)] transition-colors" title="Ver Dashboard de este Balance">
                                                        <LayoutDashboard size={18}/>
                                                    </button>
                                                    <button onClick={() => openShareModalFor(balance)} className="p-2 bg-[var(--accent-10)] text-[var(--accent)] rounded-lg hover:bg-[var(--accent-20)] transition-colors" title="Compartir Balance">
                                                        <Code size={18}/>
                                                    </button>
                                                    <button onClick={() => handleDeleteBalance(balance.id)} className="p-2 bg-[var(--red-10)] text-[var(--red)] rounded-lg hover:bg-[var(--red-20)] transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100" title="Eliminar Balance">
                                                        <Trash2 size={18}/>
                                                    </button>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                                <div className="bg-[var(--bg-input)] rounded-2xl p-4 text-center border border-[var(--border)]">
                                                    <p className="text-[10px] uppercase font-bold text-[var(--text-muted)] tracking-wider mb-1">BETS</p>
                                                    <p className="text-xl font-bold text-[var(--accent)]">{bStats.picks}</p>
                                                </div>
                                                <div className="bg-[var(--bg-input)] rounded-2xl p-4 text-center border border-[var(--border)]">
                                                    <p className="text-[10px] uppercase font-bold text-[var(--text-muted)] tracking-wider mb-1">PROFITS</p>
                                                    <p className={`text-xl font-bold ${bStats.profit >= 0 ? 'text-[var(--accent)]' : 'text-[var(--red)]'}`}>{formatCurrency(bStats.profit, includedBanks[0]?.currency)}</p>
                                                </div>
                                                <div className="bg-[var(--bg-input)] rounded-2xl p-4 text-center border border-[var(--border)]">
                                                    <p className="text-[10px] uppercase font-bold text-[var(--text-muted)] tracking-wider mb-1">ROI / YIELD</p>
                                                    <p className={`text-xl font-bold ${bStats.yieldPerc >= 0 ? 'text-[var(--accent)]' : 'text-[var(--red)]'}`}>{bStats.yieldPerc.toFixed(2)}%</p>
                                                </div>
                                                <div className="bg-[var(--bg-input)] rounded-2xl p-4 text-center border border-[var(--border)]">
                                                    <p className="text-[10px] uppercase font-bold text-[var(--text-muted)] tracking-wider mb-1">PROGRESSION</p>
                                                    <p className={`text-xl font-bold ${bStats.progression >= 0 ? 'text-[var(--accent)]' : 'text-[var(--red)]'}`}>{bStats.progression.toFixed(2)}%</p>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'settings' && viewMode === 'personal' && (
                    <div className="max-w-2xl mx-auto space-y-6 pb-20 md:pb-0">
                        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-3xl p-8 shadow-sm transition-colors">
                            <div className="flex justify-between items-center mb-8 border-b border-[var(--border)] pb-5"><div><h3 className="text-2xl font-bold text-[var(--text-main)] tracking-tight">Gestión de Bancas</h3><p className="text-[var(--text-muted)] text-sm mt-1">Sube de nivel controlando hasta 5 bancas independientes.</p></div>{banks.length < LIMITS.MAX_BANKS && (<button onClick={openAddBankModal} className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] px-4 py-2.5 rounded-xl flex items-center gap-2 text-sm font-bold transition-all shadow-[var(--shadow-glow-md)]"><Plus size={16} /> Nueva Banca</button>)}</div>
                            <div className="space-y-4">{banks.map((bank) => (<div key={bank.id} className={`relative p-6 rounded-2xl border transition-all duration-300 ${bank.id === currentBankId ? 'bg-[var(--bg-hover)] border-[var(--accent-40)] shadow-[var(--shadow-glow-sm)]' : 'bg-[var(--bg-overlay)] border-[var(--border)] hover:border-[var(--border-strong)]'}`}>{bank.id === currentBankId && (<div className="absolute -top-3 -right-3 bg-[var(--accent)] text-[var(--accent-fg)] text-[10px] font-extrabold px-3 py-1 rounded-full shadow-[var(--shadow-glow-sm)] border border-[var(--accent)] uppercase tracking-widest">Activa</div>)}<div className="flex flex-col sm:flex-row justify-between gap-6"><div className="flex-1 space-y-5"><div className="space-y-1"><label className="text-xs text-[var(--text-muted)] uppercase font-bold tracking-wider ml-1">Nombre</label><input type="text" defaultValue={bank.name} onBlur={(e) => { if (e.target.value !== bank.name) handleUpdateBank(bank.id, 'name', e.target.value); }} className="w-full bg-transparent border-b border-[var(--border-strong)] focus:border-[var(--accent)] text-xl font-bold text-[var(--text-main)] outline-none py-1.5 transition-colors placeholder-[var(--text-muted)]" /></div><div className="flex flex-wrap gap-4"><div className="flex-1 min-w-[100px] space-y-1"><label className="text-xs text-[var(--text-muted)] uppercase font-bold tracking-wider ml-1 flex items-center gap-1">Capital <Lock size={10}/></label><input type="number" value={bank.initialCapital} disabled className="w-full bg-[var(--bg-base)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-[var(--text-muted)] font-bold outline-none transition-colors text-sm cursor-not-allowed" /></div><div className="w-24 space-y-1"><label className="text-xs text-[var(--text-muted)] uppercase font-bold tracking-wider ml-1">Divisa</label><select value={bank.currency || 'EUR'} onChange={(e) => { handleUpdateBank(bank.id, 'currency', e.target.value); }} className="w-full bg-[var(--bg-base)] border border-[var(--border)] rounded-xl px-2 py-2.5 text-[var(--text-main)] text-sm outline-none appearance-none"><option value="EUR">EUR (€)</option><option value="USD">USD ($)</option><option value="GBP">GBP (£)</option><option value="MXN">MXN ($)</option></select></div><div className="flex-1 min-w-[130px] space-y-1"><label className="text-xs text-[var(--accent)] uppercase font-bold tracking-wider ml-1 flex items-center gap-1 drop-shadow-sm"><Lock size={12}/> Privacidad</label><input type="text" defaultValue={bank.premiumPassword || ''} onBlur={(e) => { handleUpdateBank(bank.id, 'premiumPassword', e.target.value); }} placeholder="Clave para ver pendientes..." className="w-full bg-[var(--bg-base)] border border-[var(--accent-30)] focus:border-[var(--accent)] rounded-xl px-3 py-2.5 text-[var(--text-main)] text-sm outline-none transition-colors shadow-inner" /></div></div></div><div className="flex flex-row sm:flex-col justify-between items-end gap-3 border-t sm:border-t-0 sm:border-l border-[var(--border)] pt-5 sm:pt-0 sm:pl-6 min-w-[140px]"><button onClick={() => handleBankChange({target: {value: bank.id}})} disabled={bank.id === currentBankId} className={`w-full px-4 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all ${bank.id === currentBankId ? 'bg-[var(--accent-10)] text-[var(--accent)] cursor-default border border-[var(--accent-30)]' : 'bg-[var(--bg-overlay)] border border-[var(--border)] text-[var(--text-main)] hover:bg-[var(--accent)] hover:text-[var(--accent-fg)] hover:border-transparent'}`}>{bank.id === currentBankId ? 'Operando' : 'Seleccionar'}</button><button onClick={() => handleDeleteBank(bank.id)} className="w-full px-4 py-3 text-xs font-bold text-[var(--text-muted)] hover:text-[var(--red)] hover:bg-[var(--red-10)] rounded-xl transition-all flex items-center justify-center gap-2 border border-transparent"><Trash2 size={16}/> Eliminar</button></div></div></div>))}</div>
                        </div>
                        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-3xl p-8 shadow-sm transition-colors">
                            <div className="mb-6"><h3 className="text-xl font-bold text-[var(--text-main)] flex items-center gap-2"><Database size={22} className="text-[var(--accent)]" /> Respaldo y Migración</h3><p className="text-[var(--text-muted)] text-sm mt-1">Exporta tus joyas o importa tu viejo Excel/Bet-Analytix.</p></div>
                            <div className="flex gap-4"><button onClick={handleExportCSV} className="flex-1 bg-[var(--bg-base)] hover:bg-[var(--bg-hover)] border border-[var(--border)] hover:border-[var(--accent-30)] text-[var(--text-main)] p-6 rounded-2xl transition-all group flex flex-col items-center gap-3 shadow-inner"><div className="p-4 bg-[var(--bg-overlay)] rounded-2xl group-hover:bg-[var(--accent-10)] transition-colors"><Download size={28} className="text-[var(--text-muted)] group-hover:text-[var(--accent)]" /></div><span className="text-sm font-bold tracking-wide">Descargar CSV</span></button><div className="flex-1 relative"><input type="file" accept=".csv" ref={fileInputRef} onChange={handleImportCSV} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" /><div className="bg-[var(--bg-base)] hover:bg-[var(--bg-hover)] border border-[var(--border)] hover:border-[var(--accent-30)] text-[var(--text-main)] p-6 rounded-2xl transition-all group flex flex-col items-center gap-3 h-full shadow-inner"><div className="p-4 bg-[var(--bg-overlay)] rounded-2xl group-hover:bg-[var(--accent-10)] transition-colors"><Upload size={28} className="text-[var(--text-muted)] group-hover:text-[var(--accent)]" /></div><span className="text-sm font-bold tracking-wide">Importar Datos</span></div></div></div>
                        </div>
                    </div>
                )}

                {activeTab === 'customization' && viewMode === 'personal' && (
                    <div className="max-w-2xl mx-auto space-y-6 pb-20 md:pb-0">
                        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-3xl p-8 shadow-sm transition-colors">
                            <div className="mb-8"><h3 className="text-2xl font-bold text-[var(--text-main)] flex items-center gap-2 tracking-tight"><Tags size={24} className="text-[var(--accent)]" /> Etiquetas Personalizadas</h3><p className="text-[var(--text-muted)] text-sm mt-2">Añade deportes de nicho o categorías para medir tu rentabilidad al milímetro.</p></div>
                            <div className="space-y-8">
                                <div className="bg-[var(--bg-base)] p-6 rounded-2xl border border-[var(--border)] shadow-inner transition-colors">
                                    <h4 className="text-sm font-extrabold text-[var(--text-main)] mb-4 uppercase tracking-widest">Mis Deportes</h4>
                                    <div className="flex gap-3 mb-5"><input type="text" value={newCustomSport} onChange={e => setNewCustomSport(e.target.value)} placeholder="Ej: Ping Pong, Dardos..." className="flex-1 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl px-4 py-3 text-[var(--text-main)] text-sm outline-none focus:border-[var(--accent-50)]"/><button onClick={() => handleAddOption('sports', newCustomSport)} className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] p-3 rounded-xl font-bold shadow-[var(--shadow-glow-sm)] transition-all"><Plus size={20}/></button></div>
                                    <div className="flex flex-wrap gap-2">{(customOptions.sports || []).map(sport => (<span key={sport} className="px-4 py-1.5 bg-[var(--bg-card)] text-[var(--text-main)] rounded-full text-xs font-bold flex items-center gap-2 border border-[var(--border)]">{sport} <button onClick={() => handleDeleteOption('sports', sport)} className="text-[var(--text-muted)] hover:text-[var(--red)] transition-colors"><X size={14}/></button></span>))}{(!customOptions.sports || customOptions.sports.length === 0) && <span className="text-sm text-[var(--text-muted)] italic bg-[var(--bg-overlay)] px-4 py-2 rounded-lg border border-dashed border-[var(--border-strong)]">No hay deportes extra definidos.</span>}</div>
                                </div>
                                <div className="bg-[var(--bg-base)] p-6 rounded-2xl border border-[var(--border)] shadow-inner transition-colors">
                                    <h4 className="text-sm font-extrabold text-[var(--text-main)] mb-4 uppercase tracking-widest">Categorías / Estrategias</h4>
                                    <div className="flex gap-3 mb-5"><input type="text" value={newCustomCategory} onChange={e => setNewCustomCategory(e.target.value)} placeholder="Ej: Reto Escalera, Stake 10..." className="flex-1 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl px-4 py-3 text-[var(--text-main)] text-sm outline-none focus:border-[var(--accent-50)]"/><button onClick={() => handleAddOption('categories', newCustomCategory)} className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] p-3 rounded-xl font-bold shadow-[var(--shadow-glow-sm)] transition-all"><Plus size={20}/></button></div>
                                    <div className="flex flex-wrap gap-2">{(customOptions.categories || []).map(cat => (<span key={cat} className="px-4 py-1.5 bg-[var(--bg-card)] text-[var(--text-main)] rounded-full text-xs font-bold flex items-center gap-2 border border-[var(--border)]">{cat} <button onClick={() => handleDeleteOption('categories', cat)} className="text-[var(--text-muted)] hover:text-[var(--red)] transition-colors"><X size={14}/></button></span>))}{(!customOptions.categories || customOptions.categories.length === 0) && <span className="text-sm text-[var(--text-muted)] italic bg-[var(--bg-overlay)] px-4 py-2 rounded-lg border border-dashed border-[var(--border-strong)]">No hay estrategias personalizadas.</span>}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
            </main>

            {showBetForm && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 md:p-6 bg-[var(--bg-modal)] backdrop-blur-md animate-in fade-in">
                <div className="bg-[var(--bg-base-95)] backdrop-blur-3xl w-full max-w-lg rounded-3xl shadow-[var(--shadow-glow-lg)] border border-[var(--accent-30)] overflow-hidden flex flex-col max-h-[95vh] transition-colors">
                    <div className="px-6 py-5 border-b border-[var(--border)] flex justify-between items-center bg-[var(--bg-card)]"><h3 className="font-extrabold text-[var(--text-main)] text-xl tracking-tight">{editingBetId ? 'Editar Apuesta' : 'Nueva Operación'}</h3><button onClick={() => setShowBetForm(false)} className="text-[var(--text-muted)] hover:text-[var(--text-main)] bg-[var(--bg-overlay)] p-2 rounded-full transition-colors"><X size={20}/></button></div>
                    <div className="p-6 overflow-y-auto space-y-5 custom-scrollbar bg-transparent">
                        
                        {/* --- BOTÓN DE IA PREMIUM --- */}
                        <div className="bg-[var(--bg-card)] border border-[var(--border)] p-5 rounded-2xl text-center relative overflow-hidden shadow-inner">
                            <div className="absolute top-0 right-0 p-2 opacity-[0.03] dark:opacity-5 pointer-events-none"><Crown size={60}/></div>
                            <p className="text-xs text-[var(--accent)] mb-3 font-bold uppercase tracking-widest flex items-center justify-center gap-2">
                                <Crown size={14}/> Análisis IA Premium
                            </p>
                            <label className={`cursor-pointer ${isScanning ? 'bg-slate-700 border-slate-600 text-slate-300' : 'bg-[var(--bg-hover)] hover:bg-[var(--bg-overlay-hover)] border-[var(--border)] text-[var(--text-main)] hover:border-[var(--accent-50)]'} border px-6 py-3 rounded-xl font-bold shadow-sm flex items-center justify-center gap-3 mx-auto w-fit transition-all`}>
                                <Upload size={18}/> {isScanning ? 'Procesando visión artificial...' : 'Subir Captura del Boleto'}
                                <input type="file" accept="image/*" onChange={escanearBoleto} className="hidden" disabled={isScanning} />
                            </label>
                            
                            {/* Burbuja de respuesta de la IA */}
                            {aiMessage && (
                                <div className="mt-4 p-4 bg-[var(--accent-10)] border border-[var(--accent-30)] rounded-2xl flex items-start gap-3 text-left animate-in fade-in slide-in-from-bottom-2">
                                    <div className="bg-[var(--accent)] text-[var(--accent-fg)] p-1.5 rounded-full mt-0.5 shadow-sm shrink-0"><Crown size={14}/></div>
                                    <p className="text-sm text-[var(--text-main)] leading-relaxed font-medium">{aiMessage}</p>
                                </div>
                            )}
                        </div>
                        {/* ------------------------ */}

                        <div className="grid grid-cols-2 gap-4"><div className="bg-[var(--bg-card)] border border-transparent rounded-xl p-2.5 flex items-center justify-between shadow-inner"><input type="date" className="bg-transparent text-[var(--text-main)] text-sm outline-none w-full font-medium" value={newBet.date} onChange={e => setNewBet({...newBet, date: e.target.value})} /> <Calendar size={16} className="text-[var(--text-muted)]" /></div><div className="bg-[var(--bg-card)] border border-transparent rounded-xl p-2.5 flex items-center justify-between shadow-inner"><input type="time" className="bg-transparent text-[var(--text-main)] text-sm outline-none w-full font-medium" value={newBet.time} onChange={e => setNewBet({...newBet, time: e.target.value})} /> <Clock size={16} className="text-[var(--text-muted)]" /></div></div>
                        <div className="space-y-1.5"><label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider ml-1">Bookie</label>{isCustomBookmaker ? (<div className="flex gap-2"><input type="text" placeholder="Escribe el nombre..." className="w-full bg-[var(--bg-card)] border border-transparent rounded-xl px-4 py-3 text-[var(--text-main)] text-sm outline-none focus:border-[var(--accent-50)] shadow-inner" autoFocus value={newBet.bookmaker} onChange={(e) => setNewBet(prev => ({ ...prev, bookmaker: e.target.value }))} /><button onClick={() => { setIsCustomBookmaker(false); setNewBet(prev => ({ ...prev, bookmaker: 'Bet365' })); }} className="text-xs font-bold text-[var(--red)] hover:opacity-80 bg-[var(--red-10)] px-3 rounded-xl">Cancelar</button></div>) : (<select className="w-full bg-[var(--bg-card)] border border-transparent rounded-xl px-4 py-3 text-[var(--text-main)] text-sm outline-none focus:border-[var(--accent-50)] shadow-inner appearance-none" value={newBet.bookmaker} onChange={handleBookieChange}>{COMMON_BOOKMAKERS.map(b => <option key={b}>{b}</option>)}<option value="Otra">Otra...</option></select>)}</div>
                        
                        {newBet.selections.map((sel, index) => (
                            <div key={sel.id} className="border border-[var(--border)] rounded-2xl bg-[var(--bg-card)] overflow-hidden shadow-sm transition-colors">
                                <div className="flex items-center justify-between p-4 cursor-pointer hover:bg-[var(--bg-hover)] transition-colors border-b border-[var(--border)]" onClick={() => toggleSelection(sel.id)}><div className="flex items-center gap-2 text-sm text-[var(--accent)] font-bold tracking-wide"><ChevronDown size={16} className={`transform transition-transform ${sel.isOpen ? 'rotate-180' : ''}`} /> Selección {index + 1}</div>{newBet.selections.length > 1 && (<button onClick={(e) => { e.stopPropagation(); handleRemoveSelection(sel.id); }} className="text-[var(--text-muted)] hover:text-[var(--red)] bg-[var(--bg-overlay)] p-1.5 rounded-lg"><X size={14}/></button>)}</div>
                                {sel.isOpen && (
                                    <div className="p-5 space-y-4 animate-in slide-in-from-top-2 bg-[var(--bg-base)]">
                                        <div className="grid grid-cols-3 gap-4"><div className="col-span-2 space-y-1.5"><label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider ml-1">Evento</label><input type="text" placeholder="Ej: RM - FCB" className="w-full bg-[var(--bg-card)] border border-transparent rounded-xl px-3 py-2.5 text-[var(--text-main)] text-sm outline-none focus:border-[var(--accent-50)] shadow-inner" value={sel.title} onChange={e => handleUpdateSelection(sel.id, 'title', e.target.value)} /></div><div className="space-y-1.5"><label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider ml-1">Cuota</label><input type="number" step="0.01" className="w-full bg-[var(--bg-card)] border border-transparent rounded-xl px-3 py-2.5 text-[var(--accent)] font-extrabold text-sm outline-none focus:border-[var(--accent-50)] shadow-inner" value={sel.odds} onChange={e => handleUpdateSelection(sel.id, 'odds', e.target.value)} /></div></div>
                                        <div className="space-y-1.5"><label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider ml-1">Pronóstico</label><input type="text" placeholder="Ej: Más de 2.5 Goles..." className="w-full bg-[var(--bg-card)] border border-transparent rounded-xl px-3 py-2.5 text-[var(--text-main)] text-sm outline-none focus:border-[var(--accent-50)] shadow-inner" value={sel.selection} onChange={e => handleUpdateSelection(sel.id, 'selection', e.target.value)} /></div>
                                        <div className="grid grid-cols-2 gap-4"><div className="space-y-1.5"><label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider ml-1">Deporte</label><select className="w-full bg-[var(--bg-card)] border border-transparent rounded-xl px-3 py-2.5 text-[var(--text-main)] text-sm outline-none shadow-inner appearance-none" value={sel.sport} onChange={e => handleUpdateSelection(sel.id, 'sport', e.target.value)}>{(customOptions.sports || []).map(s => <option key={s} value={s}>{s}</option>)}{(!customOptions.sports || customOptions.sports.length === 0) && <option value="">Sin deportes definidos</option>}</select></div><div className="space-y-1.5"><label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider ml-1">Estado</label><select className="w-full bg-[var(--bg-card)] border border-transparent rounded-xl px-3 py-2.5 text-[var(--text-main)] text-sm outline-none shadow-inner appearance-none font-bold" value={sel.status} onChange={e => handleUpdateSelection(sel.id, 'status', e.target.value)}><option value="pending" className="text-[var(--yellow)]">Pendiente</option><option value="won" className="text-[var(--accent)]">Ganada</option><option value="lost" className="text-[var(--red)]">Perdida</option><option value="void">Nula</option></select></div></div>
                                        <div className="flex justify-center pt-3 border-t border-[var(--border)]"><button className="text-xs font-bold text-[var(--text-muted)] flex items-center gap-1 hover:text-[var(--text-main)] transition-colors" onClick={(e) => { e.stopPropagation(); toggleSelection(sel.id); }}><ChevronUp size={14}/> Ocultar detalles</button></div>
                                    </div>
                                )}
                            </div>
                        ))}
                        <button onClick={handleAddSelection} className="w-full py-3 border border-dashed border-[var(--border-strong)] rounded-2xl text-[var(--text-muted)] font-bold hover:text-[var(--accent)] hover:border-[var(--accent-50)] hover:bg-[var(--accent-5)] flex items-center justify-center gap-2 text-sm transition-all shadow-sm"><Plus size={18} /> Convertir en Combinada</button>
                        
                        {newBet.selections.length > 1 && (<div className="space-y-1.5 pt-2"><label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider ml-1">Nombre de la Combi</label><input type="text" placeholder="Ej: Combi Locura Fin de Semana" className="w-full bg-[var(--bg-card)] border border-transparent rounded-xl px-4 py-3 text-[var(--text-main)] text-sm font-bold outline-none focus:border-[var(--accent-50)] shadow-inner" value={newBet.title} onChange={e => setNewBet(prev => ({ ...prev, title: e.target.value }))} /></div>)}
                        
                        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-5 space-y-5 shadow-inner transition-colors">
                            <div className="space-y-3"><label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider ml-1 flex justify-between">Inversión {formErrors.amount && <span className="text-[var(--red)] text-[10px] flex items-center gap-1"><AlertTriangle size={10}/> {formErrors.amount}</span>}</label><div className="flex gap-4"><div className={`flex-1 bg-[var(--bg-base)] border ${formErrors.amount ? 'border-[var(--red-50)]' : 'border-transparent'} rounded-xl p-3 relative group focus-within:border-[var(--accent-50)] transition-colors shadow-inner`}><span className="text-[10px] text-[var(--text-muted)] font-bold block uppercase tracking-widest mb-1">Efectivo ({currencySymbol})</span><input type="number" className="bg-transparent text-[var(--text-main)] w-full outline-none font-extrabold text-2xl" value={newBet.amount || ''} onChange={e => handleAmountChange(e.target.value, 'amount')} placeholder="0" /></div><div className="flex-1 bg-[var(--bg-base)] border border-transparent rounded-xl p-3 relative group focus-within:border-[var(--accent-50)] transition-colors shadow-inner"><span className="text-[10px] text-[var(--text-muted)] font-bold block uppercase tracking-widest mb-1">% Bank (Stake)</span><input type="number" className="bg-transparent text-[var(--text-main)] w-full outline-none font-extrabold text-2xl" value={newBet.stake || ''} onChange={e => handleAmountChange(e.target.value, 'stake')} placeholder="0" /></div></div><div className="grid grid-cols-4 gap-2 mt-3">{[10, 25, 50, 100].map(val => (<button key={val} onClick={() => handleAmountChange(val, 'amount')} className="bg-[var(--bg-overlay)] hover:bg-[var(--bg-overlay-hover)] border border-transparent rounded-lg py-2 text-xs font-bold text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors shadow-sm">{val}{currencySymbol}</button>))}</div></div>
                            <button onClick={() => setShowMoreOptions(!showMoreOptions)} className="w-full text-center text-xs font-bold text-[var(--text-muted)] hover:text-[var(--text-main)] flex items-center justify-center gap-2 mt-2 transition-colors border-t border-[var(--border)] pt-4">{showMoreOptions ? <ChevronUp size={14}/> : <ChevronDown size={14}/>} {showMoreOptions ? 'Cerrar Avanzado' : 'Opciones Avanzadas'}</button>
                            {showMoreOptions && (
                                <div className="space-y-4 pt-2 animate-in fade-in slide-in-from-top-2">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-1.5"><label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider ml-1">Comisión %</label><input type="number" className="w-full bg-[var(--bg-base)] border border-transparent rounded-xl px-3 py-2 text-[var(--text-main)] text-sm outline-none shadow-inner" value={newBet.commission} onChange={e => setNewBet({...newBet, commission: e.target.value})} placeholder="0"/></div>
                                        <div className="space-y-1.5"><label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider ml-1">Bono</label><input type="number" className="w-full bg-[var(--bg-base)] border border-transparent rounded-xl px-3 py-2 text-[var(--text-main)] text-sm outline-none shadow-inner" value={newBet.bonus} onChange={e => setNewBet({...newBet, bonus: e.target.value})} placeholder="0"/></div>
                                    </div>
                                    <div className="space-y-1.5"><label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider ml-1">Estrategia / Categoría</label><select className="w-full bg-[var(--bg-base)] border border-transparent rounded-xl px-3 py-2.5 text-[var(--text-main)] text-sm outline-none shadow-inner appearance-none" value={newBet.selections[0]?.category || ''} onChange={e => handleUpdateSelection(newBet.selections[0]?.id, 'category', e.target.value)}><option value="">General (Sin categoría)</option>{(customOptions.categories || []).map(c => <option key={c} value={c}>{c}</option>)}</select></div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="flex items-center gap-3 bg-[var(--bg-base)] px-3 py-2.5 rounded-xl shadow-inner"><input type="checkbox" checked={newBet.isLive} onChange={e => setNewBet({...newBet, isLive: e.target.checked})} className="accent-[var(--accent)] w-4 h-4"/><label className="text-xs font-bold text-[var(--text-main)]">En Vivo (Live)</label></div>
                                        <div className="flex items-center gap-3 bg-[var(--bg-base)] px-3 py-2.5 rounded-xl shadow-inner"><input type="checkbox" checked={newBet.isFreebet} onChange={e => setNewBet({...newBet, isFreebet: e.target.checked})} className="accent-pink-500 w-4 h-4"/><label className="text-xs font-bold text-[var(--text-main)]">Freebet</label></div>
                                    </div>
                                </div>
                            )}
                        </div>
                        
                        <div className="space-y-1.5 border-t border-[var(--border)] pt-4"><label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider ml-1 flex justify-between"><span>Notas</span><span className={`${newBet.analysis?.length > 1100 ? 'text-[var(--red)]' : 'text-[var(--text-muted)]'}`}>{newBet.analysis?.length || 0}/1200</span></label><textarea className="w-full bg-[var(--bg-card)] border border-transparent rounded-2xl p-4 text-[var(--text-main)] text-sm outline-none focus:border-[var(--accent-50)] min-h-[100px] resize-none shadow-inner" placeholder="Escribe tu razonamiento aquí..." maxLength={1200} value={newBet.analysis} onChange={e => setNewBet({...newBet, analysis: e.target.value})} /></div>
                    </div>
                    <div className="p-6 border-t border-[var(--border)] bg-[var(--bg-card)]"><button onClick={handleSaveBet} className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-extrabold py-4 rounded-xl flex items-center justify-center gap-2 transition-all shadow-[var(--shadow-glow-md)] hover:shadow-[var(--shadow-glow-lg)] text-lg tracking-wide"><CheckCircle2 size={22} /> {editingBetId ? 'Actualizar Operación' : 'Registrar Operación'}</button></div>
                </div>
            </div>
            )}

            {isAddingBalance && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-[var(--bg-modal)] backdrop-blur-md animate-in fade-in">
                    <div className="bg-[var(--bg-base-95)] backdrop-blur-2xl w-full max-w-sm rounded-3xl shadow-[var(--shadow-glow-lg)] border border-[var(--accent-20)] overflow-hidden flex flex-col transition-colors">
                        <div className="px-5 py-4 border-b border-[var(--border)] flex justify-between items-center bg-[var(--bg-card)]">
                            <h3 className="font-bold text-[var(--text-main)] text-lg">Nuevo Balance</h3>
                            <button onClick={() => setIsAddingBalance(false)} className="text-[var(--text-muted)] hover:text-[var(--text-main)] bg-[var(--bg-overlay)] p-1.5 rounded-full"><X size={18}/></button>
                        </div>
                        <div className="p-6 space-y-5">
                            <div className="space-y-1.5">
                                <label className="text-xs text-[var(--text-muted)] uppercase font-bold tracking-wider ml-1">Nombre del Balance</label>
                                <input type="text" placeholder="Ej: General 2026" className="w-full bg-[var(--bg-card)] border border-transparent rounded-xl px-4 py-3 text-[var(--text-main)] focus:border-[var(--accent-50)] shadow-inner outline-none transition-colors" value={newBalanceData.name} onChange={e => setNewBalanceData({...newBalanceData, name: e.target.value})} autoFocus />
                            </div>
                            <div className="space-y-3">
                                <label className="text-xs text-[var(--text-muted)] uppercase font-bold tracking-wider ml-1">Selecciona Bancas</label>
                                <div className="max-h-40 overflow-y-auto space-y-2 custom-scrollbar">
                                    {banks.map(b => (
                                        <label key={b.id} className="flex items-center gap-3 p-3 bg-[var(--bg-card)] rounded-xl border border-[var(--border)] cursor-pointer hover:bg-[var(--bg-hover)] transition-colors">
                                            <input 
                                                type="checkbox" 
                                                className="accent-[var(--accent)] w-4 h-4"
                                                checked={newBalanceData.bankIds.includes(b.id)}
                                                onChange={(e) => {
                                                    const newIds = e.target.checked 
                                                        ? [...newBalanceData.bankIds, b.id] 
                                                        : newBalanceData.bankIds.filter(id => id !== b.id);
                                                    setNewBalanceData({...newBalanceData, bankIds: newIds});
                                                }}
                                            />
                                            <span className="text-sm font-bold text-[var(--text-main)]">{b.name}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs text-[var(--text-muted)] uppercase font-bold tracking-wider ml-1 flex items-center gap-1"><Lock size={12}/> Privacidad (Opcional)</label>
                                <input type="text" placeholder="Clave para ver pendientes..." className="w-full bg-[var(--bg-card)] border border-[var(--accent-30)] focus:border-[var(--accent)] rounded-xl px-4 py-3 text-[var(--text-main)] shadow-inner outline-none transition-colors" value={newBalanceData.premiumPassword || ''} onChange={e => setNewBalanceData({...newBalanceData, premiumPassword: e.target.value})} />
                            </div>
                            <button onClick={confirmAddBalance} className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold py-3.5 rounded-xl transition-all shadow-[var(--shadow-glow-md)] mt-4 disabled:opacity-50" disabled={!newBalanceData.name || newBalanceData.bankIds.length === 0}>Crear Balance Agrupado</button>
                        </div>
                    </div>
                </div>
            )}

            {statusModalData && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-[var(--bg-modal)] backdrop-blur-md animate-in fade-in">
                    <div className="bg-[var(--bg-base-95)] backdrop-blur-2xl rounded-3xl shadow-[0_0_50px_rgba(0,0,0,0.2)] border border-[var(--accent-20)] p-8 w-full max-w-sm transition-colors"><h3 className="text-[var(--text-main)] font-extrabold text-xl mb-6 text-center tracking-tight drop-shadow-sm">Estado de la Operación</h3><div className="grid grid-cols-2 gap-4"><button onClick={() => handleQuickStatusChange('won')} className="p-4 bg-[var(--accent-10)] hover:bg-[var(--accent-20)] text-[var(--accent)] rounded-2xl font-bold border border-[var(--accent-30)] transition-all flex flex-col items-center gap-2 shadow-inner"><CheckCircle2 size={28}/> Ganada</button><button onClick={() => handleQuickStatusChange('lost')} className="p-4 bg-[var(--red-10)] hover:bg-[var(--red-20)] text-[var(--red)] rounded-2xl font-bold border border-[var(--red-30)] transition-all flex flex-col items-center gap-2 shadow-inner"><XCircle size={28}/> Perdida</button><button onClick={() => handleQuickStatusChange('void')} className="p-4 bg-[var(--bg-overlay)] hover:bg-[var(--bg-overlay-hover)] text-[var(--text-muted)] rounded-2xl font-bold border border-[var(--border-strong)] transition-all flex flex-col items-center gap-2 shadow-inner"><AlertCircle size={28}/> Nula</button><button onClick={() => handleQuickStatusChange('pending')} className="p-4 bg-yellow-500/10 hover:bg-yellow-500/20 text-[var(--yellow)] rounded-2xl font-bold border border-yellow-500/30 transition-all flex flex-col items-center gap-2 shadow-inner"><Clock size={28}/> Pendiente</button></div><button onClick={() => setStatusModalData(null)} className="mt-6 w-full py-3 text-[var(--text-muted)] font-bold hover:text-[var(--text-main)] bg-[var(--bg-card)] rounded-xl transition-colors border border-[var(--border)] hover:border-[var(--border-strong)] shadow-sm">Cancelar</button></div>
                </div>
            )}

            {/* MODAL DE COMPARTIR Y DISTRIBUCIÓN (WIDGETS) */}
            {shareModal.isOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[var(--bg-modal)] backdrop-blur-md animate-in fade-in">
                    <div className="bg-[var(--bg-card)] backdrop-blur-2xl rounded-3xl shadow-2xl border border-[var(--border-strong)] p-6 md:p-8 w-full max-w-lg transition-colors overflow-hidden relative">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-[var(--accent)] blur-[80px] opacity-20 pointer-events-none"></div>
                        <button onClick={() => setShareModal({ isOpen: false, link: '', iframe: '' })} className="absolute top-4 right-4 text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors bg-[var(--bg-overlay)] p-1.5 rounded-full"><X size={18}/></button>
                        
                        <div className="flex items-center gap-3 mb-6 relative z-10">
                            <div className="w-12 h-12 bg-[var(--accent-10)] rounded-xl flex items-center justify-center text-[var(--accent)] shadow-inner border border-[var(--accent-20)]"><Code size={24}/></div>
                            <div>
                                <h3 className="text-[var(--text-main)] font-extrabold text-xl tracking-tight">Insertar o Compartir</h3>
                                <p className="text-[var(--text-muted)] text-sm">Elige cómo quieres distribuir tus datos.</p>
                            </div>
                        </div>

                        <div className="space-y-6 relative z-10">
                            {/* Opción 1: Link Directo */}
                            <div className="bg-[var(--bg-base)] p-4 rounded-2xl border border-[var(--border)] shadow-inner">
                                <h4 className="text-xs font-bold uppercase tracking-widest text-[var(--text-main)] mb-2 flex items-center gap-2"><LinkIcon size={14} className="text-[var(--accent)]"/> Link Público (Sólo lectura)</h4>
                                <p className="text-[10px] text-[var(--text-muted)] mb-3 leading-relaxed">Envía este enlace por Telegram o WhatsApp. Cualquiera podrá ver los resultados de esta banca o balance sin registrarse.</p>
                                <div className="flex gap-2">
                                    <input type="text" readOnly value={shareModal.link} className="flex-1 bg-[var(--bg-input)] border border-[var(--border)] rounded-xl px-3 py-2.5 text-xs text-[var(--text-muted)] outline-none" />
                                    <button onClick={() => copyToClipboard(shareModal.link, "¡Enlace público copiado!")} className="bg-[var(--accent)] text-[var(--accent-fg)] px-4 py-2.5 rounded-xl text-xs font-bold hover:opacity-90 transition-opacity">Copiar</button>
                                </div>
                            </div>

                            {/* Opción 2: Widget Embebido */}
                            <div className="bg-[var(--bg-base)] p-4 rounded-2xl border border-[var(--border)] shadow-inner relative overflow-hidden">
                                <h4 className="text-xs font-bold uppercase tracking-widest text-[var(--text-main)] mb-2 flex items-center gap-2"><Layers size={14} className="text-[var(--accent)]"/> Insertar Widget en tu Web</h4>
                                <p className="text-[10px] text-[var(--text-muted)] mb-3 leading-relaxed">Copia este código HTML y pégalo en tu web (WordPress, Shopify, etc.). Se mostrará un Widget premium adaptado y sin menús laterales.</p>
                                <div className="relative group">
                                    <textarea readOnly value={shareModal.iframe} className="w-full bg-[var(--bg-input)] border border-[var(--border)] rounded-xl px-3 py-3 text-[10px] font-mono text-[var(--text-muted)] outline-none resize-none h-20 custom-scrollbar"></textarea>
                                    <button onClick={() => copyToClipboard(shareModal.iframe, "¡Código HTML del Widget copiado!")} className="absolute right-2 bottom-2 bg-[var(--accent)] text-[var(--accent-fg)] px-3 py-1.5 rounded-lg text-xs font-bold hover:opacity-90 transition-opacity shadow-md">Copiar Código</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* MODAL DE CONFIRMACIÓN / AVISO */}
            {feedbackModal.isOpen && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-[var(--bg-modal)] backdrop-blur-md animate-in fade-in">
                    <div className="bg-[var(--bg-card)] backdrop-blur-2xl rounded-3xl shadow-[0_0_50px_rgba(0,0,0,0.3)] border border-[var(--border-strong)] p-8 w-full max-w-sm text-center transition-colors">
                        {feedbackModal.type === 'alert' ? (
                            <AlertTriangle size={48} className="text-[var(--accent)] mx-auto mb-4 drop-shadow-md" />
                        ) : (
                            <AlertTriangle size={48} className="text-[var(--yellow)] mx-auto mb-4 drop-shadow-md" />
                        )}
                        <h3 className="text-[var(--text-main)] font-extrabold text-xl mb-2 tracking-tight">
                            {feedbackModal.type === 'alert' ? 'Aviso' : 'Confirmación'}
                        </h3>
                        <p className="text-[var(--text-muted)] text-sm mb-6 whitespace-pre-wrap">{feedbackModal.message}</p>
                        <div className="flex gap-3 justify-center">
                            {feedbackModal.type === 'confirm' && (
                                <button 
                                    onClick={closeFeedbackModal} 
                                    disabled={isProcessing}
                                    className="flex-1 py-3 bg-[var(--bg-input)] text-[var(--text-main)] border border-[var(--border)] rounded-xl font-bold hover:bg-[var(--bg-hover)] transition-all disabled:opacity-50"
                                >
                                    Cancelar
                                </button>
                            )}
                            <button 
                                onClick={async () => { 
                                    if (feedbackModal.type === 'confirm' && feedbackModal.onConfirm) { 
                                        setIsProcessing(true);
                                        await feedbackModal.onConfirm(); 
                                        setIsProcessing(false);
                                    } else {
                                        closeFeedbackModal(); 
                                    }
                                }} 
                                disabled={isProcessing}
                                className="flex-1 py-3 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] rounded-xl font-bold shadow-[var(--shadow-glow-md)] transition-all flex justify-center items-center gap-2 disabled:opacity-50"
                            >
                                {isProcessing ? (
                                    <><div className="w-4 h-4 border-2 border-[var(--bg-input)] border-t-[var(--accent-fg)] rounded-full animate-spin"></div> Procesando...</>
                                ) : (
                                    'Aceptar'
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
        </>
    );
}

import React, { useState, useEffect } from 'react';
import { Download, RefreshCw, AlertCircle, Package, StopCircle, Loader2, ShieldCheck, Zap, MousePointerClick, Copy, Table as TableIcon, Search, ExternalLink, Store, WifiOff, FileSpreadsheet, CreditCard, Banknote, Code, FileCode } from 'lucide-react';

const MarketScraper = () => {
  const [activeTab, setActiveTab] = useState('climario'); 
  const [products, setProducts] = useState([]);
  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState(null);
  const [stats, setStats] = useState({ total: 0, mediaPreco: 0, semEstoque: 0 });
  const [targetLink, setTargetLink] = useState("https://www.climario.com.br/ar-condicionado/ar-condicionado-multi-split");
  const [safeMode, setSafeMode] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [xlsxLoaded, setXlsxLoaded] = useState(false);
  
  // Estado para o HTML Manual
  const [useManualInput, setUseManualInput] = useState(false);
  const [manualHtml, setManualHtml] = useState("");

  useEffect(() => {
    if (window.XLSX) {
      setXlsxLoaded(true);
      return;
    }
    const script = document.createElement('script');
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    script.async = true;
    script.onload = () => setXlsxLoaded(true);
    document.body.appendChild(script);
    return () => { document.body.removeChild(script); }
  }, []);

  const STORES = {
    climario: {
      name: "Clima Rio",
      baseUrl: "https://www.climario.com.br",
      defaultLink: "https://www.climario.com.br/ar-condicionado/ar-condicionado-multi-split",
      method: "API", // Automático
      colorClass: "text-blue-600",
      bgClass: "bg-blue-600",
      lightBg: "bg-blue-50",
      borderClass: "border-blue-200"
    },
    leveros: {
      name: "Leveros",
      baseUrl: "https://www.leveros.com.br",
      defaultLink: "https://www.leveros.com.br/ar-condicionado/multi-split",
      method: "MANUAL", // Manual por padrão devido ao bloqueio
      colorClass: "text-orange-600",
      bgClass: "bg-orange-600",
      lightBg: "bg-orange-50",
      borderClass: "border-orange-200"
    }
  };

  // Ativa modo manual automaticamente para Leveros
  const handleTabChange = (storeKey) => {
    setActiveTab(storeKey);
    setTargetLink(STORES[storeKey].defaultLink);
    setProducts([]);
    setStats({ total: 0, mediaPreco: 0, semEstoque: 0 });
    setError(null);
    setProgress("");
    
    // Se for Leveros, sugere manual direto
    if (storeKey === 'leveros') {
        setUseManualInput(true);
    } else {
        setUseManualInput(false);
    }
  };

  // --- PARSERS INTELIGENTES ---

  const parseLeverosHTML = (html) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const items = [];
    const seenIds = new Set(); // Evitar duplicatas por ID ou Link

    // --- ESTRATÉGIA 1: DADOS ESTRUTURADOS (JSON-LD) ---
    // O código que você mandou tem um array raiz com vários objetos Product.
    const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    
    scripts.forEach(script => {
        try {
            const json = JSON.parse(script.innerText);
            
            // Função auxiliar para extrair de um objeto único
            const extractFromJson = (obj) => {
                if (obj && obj['@type'] === 'Product') {
                    const link = obj.offers?.url || obj.url || "";
                    if (seenIds.has(link)) return; // Já pegamos

                    const price = obj.offers?.price ? parseFloat(obj.offers.price) : 0;
                    
                    items.push({
                        id: link,
                        nome: obj.name,
                        codigo: "N/A",
                        marca: "Leveros",
                        link: link,
                        precoVista: price,
                        precoParcelado: price, // JSON-LD geralmente só traz o preço principal
                        disponivel: obj.offers?.availability?.includes('InStock') || true,
                        imagem: obj.image || ""
                    });
                    seenIds.add(link);
                }
            };

            if (Array.isArray(json)) {
                // Caso o JSON seja um array direto [Product, Product...]
                json.forEach(item => extractFromJson(item));
            } else if (json['@type'] === 'ItemList' && Array.isArray(json.itemListElement)) {
                // Caso seja uma lista estruturada
                json.itemListElement.forEach(el => extractFromJson(el.item));
            } else {
                extractFromJson(json);
            }
        } catch(e) {
            // Ignora erros de JSON inválido
        }
    });

    // Se o JSON-LD pegou itens, ótimo. Mas vamos rodar o visual também para garantir (às vezes o JSON é incompleto)
    // Se já tiver muitos itens, retornamos.
    if (items.length > 5) return items;


    // --- ESTRATÉGIA 2: SELETORES VISUAIS (CLASSES NUXT) ---
    // Baseado no HTML: <div class="products__item product-card column">
    const cards = doc.querySelectorAll('.product-card');
    
    cards.forEach(card => {
        // Seletores específicos do Nuxt da Leveros
        const nameEl = card.querySelector('.product-card__bottom__name') || card.querySelector('.vtex-product-summary-2-x-productBrand');
        const linkEl = card.querySelector('a'); // Geralmente o card todo ou titulo é link
        const imgEl = card.querySelector('img');
        const priceEl = card.querySelector('.prices__price') || card.querySelector('.vtex-product-summary-2-x-sellingPrice');
        const installmentEl = card.querySelector('.installment'); // Para tentar achar preço parcelado

        if (nameEl) {
            const link = linkEl ? linkEl.getAttribute('href') : "";
            const fullLink = link && !link.startsWith('http') ? `https://www.leveros.com.br${link}` : link;

            if (seenIds.has(fullLink)) return;

            let pVista = 0;
            let pParcelado = 0;

            // Extração de preço à vista
            if (priceEl) {
                const priceText = priceEl.innerText.replace(/[^\d,]/g, '').replace(',', '.');
                pVista = parseFloat(priceText);
            }

            // Extração de preço parcelado (tentativa)
            if (installmentEl) {
                // Ex: "ou 8x de R$ 674,88" -> pega o valor da parcela e multiplica
                const text = installmentEl.innerText;
                const match = text.match(/(\d+)x.*?R\$\s*([\d\.,]+)/);
                if (match) {
                    const parcelas = parseInt(match[1]);
                    const valorParcela = parseFloat(match[2].replace(/\./g, '').replace(',', '.'));
                    pParcelado = parcelas * valorParcela;
                }
            }
            
            // Se não achou parcelado específico, usa o mesmo do vista como fallback (ou vice-versa)
            if (pParcelado === 0 && pVista > 0) pParcelado = pVista; 
            if (pVista === 0 && pParcelado > 0) pVista = pParcelado;

            items.push({
                id: fullLink,
                nome: nameEl.innerText.trim(),
                codigo: "N/A", // Difícil pegar no visual
                marca: "Leveros",
                link: fullLink,
                precoVista: pVista,
                precoParcelado: pParcelado,
                disponivel: true, // Se aparece na lista, geralmente está disponível
                imagem: imgEl ? imgEl.src : ""
            });
            seenIds.add(fullLink);
        }
    });

    return items;
  };

  // --- PROCESSAMENTO MANUAL ---
  const processManualHtml = async () => {
    if (!manualHtml) {
        setError("Por favor, cole o código HTML no campo abaixo.");
        return;
    }

    setIsScanning(true);
    setError(null);
    setProgress("Processando código fonte...");
    
    try {
        await new Promise(r => setTimeout(r, 300)); // UI feedback
        
        let extractedItems = [];
        
        // Verifica qual loja para usar o parser correto (embora Leveros seja o foco)
        if (activeTab === 'leveros') {
            extractedItems = parseLeverosHTML(manualHtml);
        } else {
            // Parser genérico para outros casos
            extractedItems = parseLeverosHTML(manualHtml);
        }

        if (extractedItems.length > 0) {
            setProducts(extractedItems);
            calculateStats(extractedItems);
            setProgress(`Sucesso! ${extractedItems.length} produtos identificados.`);
        } else {
            setError("Nenhum produto identificado. Verifique se copiou o HTML correto da página de listagem.");
        }

    } catch (e) {
        setError(`Erro ao processar: ${e.message}`);
    } finally {
        setIsScanning(false);
    }
  };

  // --- AUTOMATED FETCH (Mantido para Clima Rio) ---
  const fetchProxy = async (targetUrl) => {
    const encodedUrl = encodeURIComponent(targetUrl);
    const random = Date.now();
    const proxies = [
      { name: 'AllOrigins', url: `https://api.allorigins.win/get?url=${encodedUrl}&rand=${random}`, mode: 'wrapper' },
      { name: 'CodeTabs', url: `https://api.codetabs.com/v1/proxy?quest=${encodedUrl}`, mode: 'direct' }
    ];

    for (const proxy of proxies) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        const res = await fetch(proxy.url, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error(`Status ${res.status}`);
        
        let data;
        if (proxy.mode === 'wrapper') {
            const json = await response.json();
            if (json.status?.http_code >= 400) throw new Error(`Erro ${json.status.http_code}`);
            data = JSON.parse(json.contents);
        } else {
            data = await res.json();
        }
        return data;
      } catch (e) { await new Promise(r => setTimeout(r, 500)); }
    }
    throw new Error("Falha na conexão.");
  };

  const getCategoryPath = (url) => {
    try {
        const urlObj = new URL(url);
        return urlObj.pathname.replace(/^\/+|\/+$/g, '');
    } catch { return ''; }
  };

  const scanAllProducts = async () => {
    if (useManualInput) {
        processManualHtml();
        return;
    }

    setIsScanning(true);
    setError(null);
    setProducts([]);
    setProgress("Iniciando varredura automática...");

    let allCollectedItems = [];
    let page = 1;
    let hasMore = true;
    let fails = 0;

    const currentStore = STORES[activeTab];
    const categoryPath = getCategoryPath(targetLink);

    try {
      while (hasMore) {
        setProgress(`Página ${page}... (${allCollectedItems.length} itens)`);
        let newData = [];

        // Clima Rio (Automático)
        if (activeTab === 'climario') {
            const from = (page - 1) * 24;
            const to = from + 23;
            const url = `${currentStore.baseUrl}/api/catalog_system/pub/products/search/${categoryPath}?_from=${from}&_to=${to}&O=OrderByTopSaleDESC`;
            
            try {
                const data = await fetchProxy(url);
                if (Array.isArray(data)) {
                    newData = data.map(i => ({
                        id: i.productId,
                        nome: i.productName,
                        codigo: i.productReference,
                        marca: i.brand,
                        link: i.link,
                        precoVista: i.items[0]?.sellers[0]?.commertialOffer?.SpotPrice || i.items[0]?.sellers[0]?.commertialOffer?.Price || 0,
                        precoParcelado: i.items[0]?.sellers[0]?.commertialOffer?.Price || 0,
                        disponivel: i.items[0]?.sellers[0]?.commertialOffer?.AvailableQuantity > 0,
                        imagem: i.items[0]?.images[0]?.imageUrl
                    }));
                }
            } catch (e) { fails++; }
        }

        if (newData.length > 0) {
            allCollectedItems = [...allCollectedItems, ...newData];
            setProducts([...allCollectedItems]);
            calculateStats(allCollectedItems);
            page++;
            fails = 0;
            await new Promise(r => setTimeout(r, 1000));
        } else {
            fails++;
        }

        if (fails >= 3 || page > 20) hasMore = false;
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsScanning(false);
      setProgress("Concluído");
    }
  };

  const calculateStats = (data) => {
    const total = data.length;
    const comPreco = data.filter(p => p.precoVista > 0);
    const media = comPreco.reduce((acc, curr) => acc + curr.precoVista, 0) / (comPreco.length || 1);
    const semEstoque = data.filter(p => !p.disponivel).length;
    setStats({ total, mediaPreco: media, semEstoque });
  };

  const copyToClipboard = () => {
    if (products.length === 0) return;
    const text = ["Nome\tMarca\tRef\tÀ Vista\tParcelado\tLink", 
        ...products.map(p => `${p.nome}\t${p.marca}\t${p.codigo}\t${p.precoVista}\t${p.precoParcelado}\t${p.link}`)
    ].join('\n');
    navigator.clipboard.writeText(text);
    alert("Copiado!");
  };

  const downloadExcel = () => {
    if (!products.length || !window.XLSX) return;
    const ws = window.XLSX.utils.json_to_sheet(products.map(p => ({
        "Loja": STORES[activeTab].name,
        "Produto": p.nome,
        "Marca": p.marca,
        "Ref": p.codigo,
        "À Vista": p.precoVista,
        "Parcelado": p.precoParcelado,
        "Disponível": p.disponivel ? "Sim" : "Não",
        "Link": p.link
    })));
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, "Dados");
    window.XLSX.writeFile(wb, `${activeTab}_${Date.now()}.xlsx`);
  };

  const filtered = products.filter(p => 
    p.codigo?.toLowerCase().includes(searchTerm.toLowerCase()) || 
    p.nome?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="p-6 max-w-[1400px] mx-auto bg-slate-50 min-h-screen font-sans">
      <div className="mb-6 bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                <TableIcon className={STORES[activeTab].colorClass} /> Comparador (Manual & Auto)
            </h1>
            <div className="flex bg-slate-100 rounded-lg p-1">
                {Object.keys(STORES).map(key => (
                    <button key={key} onClick={() => handleTabChange(key)} 
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === key ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'}`}>
                        {STORES[key].name}
                    </button>
                ))}
            </div>
        </div>

        {isScanning && (
            <div className="mb-4 flex items-center gap-2 bg-blue-50 text-blue-700 px-4 py-3 rounded-lg text-sm font-medium animate-pulse">
                <Loader2 className="w-4 h-4 animate-spin" /> {progress}
            </div>
        )}

        <div className="flex flex-col gap-4 mb-6">
            <div className="flex items-center gap-2">
                <button 
                    onClick={() => setUseManualInput(!useManualInput)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold border transition-colors ${useManualInput ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                >
                    {useManualInput ? <FileCode className="w-4 h-4" /> : <RefreshCw className="w-4 h-4" />}
                    {useManualInput ? 'Modo Manual (HTML)' : 'Modo Automático (API)'}
                </button>
            </div>

            {useManualInput ? (
                <div className="animate-in fade-in slide-in-from-top-2 p-4 bg-slate-50 rounded-xl border border-slate-200">
                    <label className="block text-sm font-bold text-slate-700 mb-2">
                        Instruções para {STORES[activeTab].name}:
                        <span className="font-normal block text-slate-500 mt-1">
                            1. Acesse a página da categoria no navegador.<br/>
                            2. Role até o fim para carregar todos os produtos.<br/>
                            3. Aperte <strong>Ctrl+U</strong> (Ver código fonte) &rarr; <strong>Ctrl+A</strong> (Selecionar tudo) &rarr; <strong>Ctrl+C</strong>.<br/>
                            4. Cole tudo na caixa abaixo e clique em Processar.
                        </span>
                    </label>
                    <textarea 
                        value={manualHtml}
                        onChange={(e) => setManualHtml(e.target.value)}
                        className="w-full h-48 p-3 border border-slate-300 rounded-lg text-xs font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500 mb-3"
                        placeholder="Cole o código HTML gigante aqui..."
                    />
                    <div className="flex justify-end">
                        <button 
                            onClick={scanAllProducts} 
                            disabled={!manualHtml || isScanning}
                            className="flex items-center gap-2 px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-bold shadow-sm"
                        >
                            <Zap className="w-4 h-4" /> Processar Dados
                        </button>
                    </div>
                </div>
            ) : (
                <div className="flex gap-2 animate-in fade-in">
                    <input type="text" value={targetLink} onChange={(e) => setTargetLink(e.target.value)} className="flex-1 p-3 border border-slate-300 rounded-lg text-sm font-mono" placeholder="URL da Categoria" />
                    <button onClick={scanAllProducts} disabled={isScanning} className={`flex items-center gap-2 px-6 py-3 rounded-lg font-bold text-white transition-all ${isScanning ? 'bg-slate-400' : STORES[activeTab].bgClass}`}>
                        {isScanning ? <StopCircle className="w-5 h-5" /> : <MousePointerClick className="w-5 h-5" />} Buscar
                    </button>
                </div>
            )}
        </div>

        {products.length > 0 && (
            <div className="flex gap-3 mb-2 animate-in slide-in-from-left-2">
                <button onClick={copyToClipboard} className="flex items-center gap-2 px-4 py-2 rounded-lg border hover:bg-slate-50 font-semibold text-slate-700 text-sm">
                    <Copy className="w-4 h-4" /> Copiar Tabela
                </button>
                <button onClick={downloadExcel} disabled={!xlsxLoaded} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-50 text-green-700 border border-green-200 font-semibold hover:bg-green-100 text-sm">
                    <FileSpreadsheet className="w-4 h-4" /> Baixar Excel
                </button>
            </div>
        )}

        {error && <div className="mt-4 p-4 bg-red-50 text-red-700 rounded-lg flex items-center gap-2 text-sm border border-red-100"><AlertCircle className="w-5 h-5"/>{error}</div>}
      </div>

      {products.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-[600px]">
            <div className="p-4 border-b border-slate-200 flex items-center gap-3">
                <Search className="w-5 h-5 text-slate-400" />
                <input type="text" placeholder="Filtrar resultado..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="flex-1 border-none focus:ring-0 text-sm" />
                <span className="text-xs font-bold text-slate-500">{filtered.length} itens</span>
            </div>
            <div className="overflow-auto flex-1">
                <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 bg-slate-50 z-10 font-bold text-slate-600 border-b">
                        <tr>
                            <th className="p-3">Produto</th>
                            <th className="p-3 w-32">Ref</th>
                            <th className="p-3 w-32 text-right">À Vista</th>
                            <th className="p-3 w-32 text-right">Parcelado</th>
                            <th className="p-3 w-24 text-center">Link</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {filtered.map((p, i) => (
                            <tr key={i} className="hover:bg-slate-50">
                                <td className="p-3 flex items-center gap-2">
                                    {p.imagem && <img src={p.imagem} className="w-8 h-8 object-contain rounded border bg-white" />}
                                    <span className="line-clamp-2" title={p.nome}>{p.nome}</span>
                                </td>
                                <td className="p-3 font-mono text-xs text-slate-500">{p.codigo}</td>
                                <td className="p-3 text-right font-bold text-green-700 bg-green-50/30">{p.precoVista?.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</td>
                                <td className="p-3 text-right text-slate-600">{p.precoParcelado?.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</td>
                                <td className="p-3 text-center">
                                    <a href={p.link} target="_blank" rel="noreferrer" className="text-blue-600 hover:bg-blue-100 p-1.5 rounded-md inline-block"><ExternalLink className="w-4 h-4" /></a>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
      )}
    </div>
  );
};

export default MarketScraper;
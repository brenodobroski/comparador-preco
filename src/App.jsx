import React, { useState, useEffect } from 'react';
import { Download, RefreshCw, AlertCircle, Package, StopCircle, Loader2, ShieldCheck, Zap, MousePointerClick, Copy, Table as TableIcon, Search, ExternalLink, Store, WifiOff, FileSpreadsheet, CreditCard, Banknote } from 'lucide-react';

const MarketScraper = () => {
  const [activeTab, setActiveTab] = useState('climario'); // 'climario' | 'leveros'
  const [products, setProducts] = useState([]);
  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState(null);
  const [stats, setStats] = useState({ total: 0, mediaPreco: 0, semEstoque: 0 });
  const [targetLink, setTargetLink] = useState("https://www.climario.com.br/ar-condicionado/ar-condicionado-multi-split");
  const [safeMode, setSafeMode] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [xlsxLoaded, setXlsxLoaded] = useState(false);

  // Carregar biblioteca SheetJS (XLSX) dinamicamente via CDN para ambiente local
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
    return () => {
      // Cleanup opcional
    }
  }, []);

  // Configurações das Lojas
  const STORES = {
    climario: {
      name: "Clima Rio",
      baseUrl: "https://www.climario.com.br",
      defaultLink: "https://www.climario.com.br/ar-condicionado/ar-condicionado-multi-split",
      colorClass: "text-blue-600",
      bgClass: "bg-blue-600",
      lightBg: "bg-blue-50",
      borderClass: "border-blue-200"
    },
    leveros: {
      name: "Leveros",
      baseUrl: "https://www.leveros.com.br",
      defaultLink: "https://www.leveros.com.br/ar-condicionado/multi-split",
      colorClass: "text-orange-600",
      bgClass: "bg-orange-600",
      lightBg: "bg-orange-50",
      borderClass: "border-orange-200"
    }
  };

  const handleTabChange = (storeKey) => {
    setActiveTab(storeKey);
    setTargetLink(STORES[storeKey].defaultLink);
    setProducts([]);
    setStats({ total: 0, mediaPreco: 0, semEstoque: 0 });
    setError(null);
    setProgress("");
  };

  // Sistema de Proxies V8 (Timeout estendido e Tratamento de Erros)
  const fetchWithRetries = async (targetUrl) => {
    const randomParam = `&_t=${Date.now()}`;
    const finalUrl = targetUrl.includes('?') ? targetUrl + randomParam : targetUrl + '?' + randomParam;
    const encodedUrl = encodeURIComponent(finalUrl);

    const proxies = [
      {
        name: 'AllOrigins',
        url: `https://api.allorigins.win/get?url=${encodedUrl}`,
        type: 'wrapper'
      },
      {
        name: 'ThingProxy',
        url: `https://thingproxy.freeboard.io/fetch/${finalUrl}`,
        type: 'direct'
      },
      {
        name: 'CodeTabs',
        url: `https://api.codetabs.com/v1/proxy?quest=${encodedUrl}`,
        type: 'direct'
      }
    ];

    let lastError = null;

    for (const proxy of proxies) {
      let timeoutId;
      try {
        const controller = new AbortController();
        // Aumentado para 30s para evitar "signal is aborted" em conexões lentas
        timeoutId = setTimeout(() => controller.abort(), 30000); 

        const response = await fetch(proxy.url, { 
            signal: controller.signal,
            headers: { 'Accept': 'application/json' }
        });
        
        if (!response.ok) throw new Error(`Proxy ${proxy.name} status ${response.status}`);

        let data;

        if (proxy.type === 'wrapper') {
            const json = await response.json();
            if (json.status?.http_code >= 400) throw new Error(`Loja recusou conexão (${json.status.http_code})`);
            try {
                if (!json.contents) throw new Error("Conteúdo vazio");
                data = JSON.parse(json.contents);
            } catch {
                throw new Error("Conteúdo retornado não é JSON");
            }
        } else {
            const text = await response.text();
            if (text.trim().startsWith('<') || text.includes('<!DOCTYPE') || text.includes('Captcha')) {
                throw new Error("Bloqueio de Segurança (WAF)");
            }
            try {
                data = JSON.parse(text);
            } catch {
                throw new Error("JSON malformado");
            }
        }
        return data; // Sucesso
      } catch (err) {
        // Tratamento específico para erro de aborto/timeout
        const isTimeout = err.name === 'AbortError' || err.message.includes('aborted');
        const errorMessage = isTimeout ? 'Tempo limite excedido (Timeout)' : err.message;

        console.warn(`Erro no proxy ${proxy.name}:`, errorMessage);
        lastError = new Error(errorMessage);
        
        await new Promise(r => setTimeout(r, 1500));
      } finally {
        // Garante limpeza do timer
        if (timeoutId) clearTimeout(timeoutId);
      }
    }
    throw lastError || new Error("Falha geral de conexão.");
  };

  const getCategoryPath = (url) => {
    try {
        const cleanUrl = url.trim();
        const urlObj = new URL(cleanUrl);
        let path = urlObj.pathname.replace(/^\/+/, ''); 
        return path;
    } catch (e) {
        return STORES[activeTab].defaultLink.split('.com.br/')[1]; 
    }
  };

  const scanAllProducts = async () => {
    setIsScanning(true);
    setError(null);
    setProducts([]);
    setProgress("Conectando...");

    let allCollectedItems = [];
    let from = 0;
    const batchSize = 24;
    let hasMore = true;
    let pageCount = 1;
    let consecutiveErrors = 0;

    const categoryPath = getCategoryPath(targetLink);
    const currentStore = STORES[activeTab];

    try {
      while (hasMore) {
        const to = from + batchSize - 1;
        setProgress(`Lendo página ${pageCount}... (Itens ${from}-${to})`);

        const targetUrl = `${currentStore.baseUrl}/api/catalog_system/pub/products/search/${categoryPath}?_from=${from}&_to=${to}&O=OrderByTopSaleDESC&sc=1`;
        
        try {
            const data = await fetchWithRetries(targetUrl);
            consecutiveErrors = 0;

            if (!data || data.length === 0) {
                hasMore = false;
                setProgress("Varredura finalizada!");
            } else {
                const processedBatch = data.map(item => {
                    const sku = item.items && item.items[0];
                    const seller = sku && sku.sellers && sku.sellers[0];
                    const offer = seller && seller.commertialOffer;

                    // Lógica para diferenciar Preço à Vista (Spot) vs Parcelado (Price)
                    // Na VTEX, SpotPrice é o preço "no boleto/pix". Price é o preço base.
                    const precoVista = offer ? (offer.SpotPrice || offer.Price) : 0;
                    const precoParcelado = offer ? offer.Price : 0;

                    return {
                        id: item.productId,
                        nome: item.productName,
                        codigo: item.productReference,
                        skuId: sku ? sku.itemId : 'N/A',
                        precoVista: precoVista,
                        precoParcelado: precoParcelado,
                        precoLista: offer ? offer.ListPrice : 0,
                        disponivel: offer ? offer.AvailableQuantity > 0 : false,
                        link: item.link,
                        marca: item.brand,
                        imagem: sku && sku.images && sku.images[0] ? sku.images[0].imageUrl : ''
                    };
                });

                allCollectedItems = [...allCollectedItems, ...processedBatch];
                setProducts([...allCollectedItems]);
                calculateStats(allCollectedItems);
                
                from += batchSize;
                pageCount++;
                
                const delay = safeMode ? 3000 : 1500;
                await new Promise(r => setTimeout(r, delay));
            }
        } catch (err) {
            consecutiveErrors++;
            console.error(`Erro bloco ${pageCount}:`, err.message);
            
            const retryDelay = consecutiveErrors * 3000; 
            setProgress(`Erro (${err.message}). Retentando em ${retryDelay/1000}s... (${consecutiveErrors}/3)`);
            
            await new Promise(r => setTimeout(r, retryDelay));

            if (consecutiveErrors >= 3) {
                setError(`Falha persistente na conexão. Motivo: ${err.message}.`);
                hasMore = false; 
            }
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsScanning(false);
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
    const headers = ["Nome", "Marca", "Ref", "Preço à Vista", "Preço Parcelado", "Link"];
    const rows = filteredProducts.map(p => 
      `${p.nome}\t${p.marca}\t${p.codigo}\t${p.precoVista.toString().replace('.', ',')}\t${p.precoParcelado.toString().replace('.', ',')}\t${p.link}`
    );
    const text = [headers.join('\t'), ...rows].join('\n');
    navigator.clipboard.writeText(text);
    alert("Dados copiados!");
  };

  const downloadExcel = () => {
    if (products.length === 0) return;
    const storeName = STORES[activeTab].name;

    const dataForExcel = products.map(p => ({
        "Loja": storeName,
        "Nome do Produto": p.nome,
        "Marca": p.marca,
        "Referência": p.codigo,
        "Preço à Vista (R$)": p.precoVista || 0,
        "Preço Parcelado (R$)": p.precoParcelado || 0,
        "Preço de Lista (De)": p.precoLista || 0,
        "Disponível": p.disponivel ? "Sim" : "Não",
        "Link": p.link || "Link Indisponível" // Garante que o campo existe
    }));

    if (window.XLSX) {
        const ws = window.XLSX.utils.json_to_sheet(dataForExcel);
        const wscols = [
            {wch: 10}, {wch: 50}, {wch: 15}, {wch: 20}, {wch: 15}, {wch: 15}, {wch: 15}, {wch: 10}, {wch: 60}
        ];
        ws['!cols'] = wscols;
        const wb = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(wb, ws, "Preços");
        window.XLSX.writeFile(wb, `${activeTab}_tabela_precos_${new Date().toISOString().slice(0,10)}.xlsx`);
    } else {
        alert("A biblioteca Excel ainda está carregando. Tente novamente em 2 segundos.");
    }
  };

  const filteredProducts = products.filter(p => 
    p.codigo?.toLowerCase().includes(searchTerm.toLowerCase()) || 
    p.nome?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="p-6 max-w-[1400px] mx-auto bg-slate-50 min-h-screen font-sans">
      <div className="mb-6 bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        
        {/* Cabeçalho com Abas */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
            <div>
                <h1 className="text-2xl font-bold text-slate-800 mb-1 flex items-center gap-2">
                    <TableIcon className={STORES[activeTab].colorClass} /> 
                    Extrator de Preços
                </h1>
                <p className="text-slate-500 text-sm">
                    Comparativo de mercado: Clima Rio vs Leveros
                </p>
            </div>

            <div className="flex p-1 bg-slate-100 rounded-lg">
                <button
                    onClick={() => handleTabChange('climario')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                        activeTab === 'climario' 
                        ? 'bg-white text-blue-600 shadow-sm' 
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                >
                    <Store className="w-4 h-4" /> Clima Rio
                </button>
                <button
                    onClick={() => handleTabChange('leveros')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                        activeTab === 'leveros' 
                        ? 'bg-white text-orange-600 shadow-sm' 
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                >
                    <Store className="w-4 h-4" /> Leveros
                </button>
            </div>
        </div>

        {/* Barra de Progresso / Status */}
        {isScanning && (
            <div className={`mb-4 flex items-center gap-2 ${STORES[activeTab].lightBg} ${STORES[activeTab].colorClass} px-4 py-3 rounded-lg text-sm font-medium animate-pulse border ${STORES[activeTab].borderClass}`}>
                <Loader2 className="w-4 h-4 animate-spin" />
                {progress}
            </div>
        )}

        {/* Inputs e Ações */}
        <div className="grid gap-4 mb-6">
            <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Link da Categoria ({STORES[activeTab].name})</label>
                <div className="flex gap-2">
                    <input 
                        type="text" 
                        value={targetLink}
                        onChange={(e) => setTargetLink(e.target.value)}
                        className={`w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:outline-none text-sm font-mono text-slate-600 ${
                            activeTab === 'climario' ? 'focus:ring-blue-500 focus:border-blue-500' : 'focus:ring-orange-500 focus:border-orange-500'
                        }`}
                        placeholder="Cole o link aqui"
                    />
                </div>
            </div>
            
            <div className="flex items-center gap-2">
                <button
                    onClick={() => setSafeMode(!safeMode)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                        safeMode ? 'bg-green-50 text-green-700 border-green-200' : 'bg-yellow-50 text-yellow-700 border-yellow-200'
                    }`}
                >
                    {safeMode ? <ShieldCheck className="w-3 h-3" /> : <Zap className="w-3 h-3" />}
                    {safeMode ? 'Modo Seguro (Recomendado)' : 'Modo Rápido'}
                </button>
            </div>
        </div>

        <div className="flex gap-4 flex-wrap">
          <button
            onClick={scanAllProducts}
            disabled={isScanning}
            className={`flex items-center gap-2 px-6 py-3 rounded-lg font-semibold text-white transition-all ${
              isScanning 
                ? 'bg-slate-400 cursor-not-allowed' 
                : `${STORES[activeTab].bgClass} hover:opacity-90 shadow-md hover:shadow-lg`
            }`}
          >
            {isScanning ? <StopCircle className="w-5 h-5" /> : <MousePointerClick className="w-5 h-5" />}
            {isScanning ? 'Parar' : `Buscar na ${STORES[activeTab].name}`}
          </button>

          {products.length > 0 && (
            <>
                <button
                onClick={copyToClipboard}
                disabled={isScanning}
                className={`flex items-center gap-2 px-6 py-3 rounded-lg font-semibold transition-all disabled:opacity-50 ${STORES[activeTab].lightBg} ${STORES[activeTab].colorClass} border ${STORES[activeTab].borderClass} hover:bg-white`}
                >
                <Copy className="w-5 h-5" />
                Copiar
                </button>

                <button
                onClick={downloadExcel}
                disabled={isScanning || !xlsxLoaded}
                className="flex items-center gap-2 px-6 py-3 rounded-lg font-semibold text-green-700 bg-white hover:bg-green-50 border border-green-200 transition-all disabled:opacity-50 shadow-sm"
                >
                <FileSpreadsheet className="w-5 h-5 text-green-600" />
                Baixar Excel (.xlsx)
                </button>
            </>
          )}
        </div>

        {error && (
          <div className="mt-4 p-4 bg-red-50 text-red-700 rounded-lg flex items-start gap-3 border border-red-100 text-sm">
            <WifiOff className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div className="flex flex-col gap-1">
                <span className="font-bold">Erro de Conexão</span>
                <span>{error}</span>
                <span className="text-xs mt-1 text-red-600/80">
                    Sugestão: Use o modo seguro, aguarde alguns minutos ou troque de rede.
                </span>
            </div>
          </div>
        )}
      </div>

      {products.length > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-200">
              <div className="text-xs text-slate-500 uppercase font-bold">Total Itens</div>
              <div className="text-2xl font-bold text-slate-800">{stats.total}</div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-200">
              <div className="text-xs text-slate-500 uppercase font-bold">Média (À Vista)</div>
              <div className={`text-lg font-bold truncate ${STORES[activeTab].colorClass}`}>
                {stats.mediaPreco.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              </div>
            </div>
             <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-200">
              <div className="text-xs text-slate-500 uppercase font-bold">Menor Preço</div>
              <div className="text-lg font-bold text-green-600 truncate">
                {products.length > 0 
                    ? Math.min(...products.filter(p=>p.precoVista>0).map(p=>p.precoVista)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                    : "R$ 0,00"}
              </div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-200">
              <div className="text-xs text-slate-500 uppercase font-bold">Indisponíveis</div>
              <div className="text-2xl font-bold text-orange-500">{stats.semEstoque}</div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-[700px]">
             {/* Barra de Busca por Referência */}
             <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center gap-3 sticky top-0 z-20">
                <Search className="w-5 h-5 text-slate-400" />
                <input
                    type="text"
                    placeholder="Filtrar por Referência (ex: 36000, 42AFC...) ou Nome"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className={`flex-1 bg-white border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 uppercase placeholder:normal-case ${activeTab === 'climario' ? 'focus:ring-blue-500' : 'focus:ring-orange-500'}`}
                />
                {searchTerm && (
                    <div className="text-xs text-slate-500">
                        {filteredProducts.length} resultados
                    </div>
                )}
            </div>

            <div className="overflow-auto flex-1">
              <table className="w-full text-left border-collapse relative">
                <thead className="sticky top-0 bg-slate-100 z-10 shadow-sm ring-1 ring-slate-200">
                  <tr className="text-slate-600 text-xs uppercase tracking-wider">
                    <th className="p-4 font-bold bg-slate-100">Produto</th>
                    <th className="p-4 font-bold bg-slate-100 w-32">Marca</th>
                    <th className="p-4 font-bold bg-slate-100 w-40">Ref (Código)</th>
                    <th className="p-4 font-bold bg-slate-100 w-32 text-right">
                        <div className="flex items-center justify-end gap-1">
                            <Banknote className="w-3 h-3 text-green-600" /> À Vista
                        </div>
                    </th>
                    <th className="p-4 font-bold bg-slate-100 w-32 text-right">
                        <div className="flex items-center justify-end gap-1">
                            <CreditCard className="w-3 h-3 text-blue-600" /> Parcelado
                        </div>
                    </th>
                    <th className="p-4 font-bold bg-slate-100 w-24 text-center">Link</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm bg-white">
                  {filteredProducts.map((item, idx) => (
                    <tr key={`${item.id}-${idx}`} className={`transition-colors group ${activeTab === 'climario' ? 'hover:bg-blue-50' : 'hover:bg-orange-50'}`}>
                      <td className="p-3">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 flex-shrink-0 bg-white border border-slate-100 rounded flex items-center justify-center">
                            {item.imagem ? (
                                <img src={item.imagem} alt="" className="w-8 h-8 object-contain" />
                            ) : <Package className="w-5 h-5 text-slate-300"/>}
                          </div>
                          <div className="min-w-0">
                             <span className="text-slate-700 font-medium line-clamp-2 leading-tight" title={item.nome}>
                                {item.nome}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="p-3 text-slate-600 font-medium text-xs">
                        {item.marca}
                      </td>
                      <td className="p-3 text-slate-800 font-mono text-xs select-all font-bold bg-slate-50 rounded">
                        {item.codigo}
                      </td>
                      <td className="p-3 font-bold text-green-700 text-right font-mono text-base bg-green-50/50">
                        {item.precoVista > 0 
                          ? item.precoVista.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) 
                          : <span className="text-slate-300">-</span>}
                      </td>
                      <td className="p-3 text-slate-600 text-right font-mono text-sm">
                        {item.precoParcelado > 0 
                          ? item.precoParcelado.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) 
                          : <span className="text-slate-300">-</span>}
                      </td>
                      <td className="p-3 text-center">
                        <a 
                            href={item.link} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className={`inline-flex items-center justify-center p-2 rounded-full transition-colors ${
                                activeTab === 'climario' 
                                ? 'text-blue-600 hover:bg-blue-100' 
                                : 'text-orange-600 hover:bg-orange-100'
                            }`}
                            title="Ir para página do produto"
                        >
                            <ExternalLink className="w-4 h-4" />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-3 bg-slate-50 border-t border-slate-200 text-xs text-slate-500 text-center">
                Mostrando {filteredProducts.length} de {products.length} registros da {STORES[activeTab].name}.
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default MarketScraper;
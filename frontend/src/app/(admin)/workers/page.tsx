"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { Server, Zap, HardDrive, RefreshCw, Plus, Cpu, Activity, Info, Trash2, PowerOff, Flag, FlagOff, Heart, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const BindSelector = ({ subs, groupedNodes, workers, selectedInQueue = [], onSelect }: any) => {
  const [activeTab, setActiveTab] = useState<string>('system');

  return (
    <div className="flex h-full w-full bg-background rounded-xl text-left">
      <div className="w-[35%] bg-muted/20 border-r border-border/40 overflow-y-auto flex flex-col py-2">
        <div className="px-3 py-1.5 text-[10px] font-bold text-muted-foreground mb-1 uppercase tracking-wider">绑定策略类别</div>
        <button className={`w-full text-left px-4 py-2 text-sm transition-colors ${activeTab === 'system' ? 'bg-primary/10 text-primary font-medium border-l-2 border-primary' : 'hover:bg-muted/50 text-foreground'}`} onClick={() => setActiveTab('system')}>系统策略</button>
        
        {subs.length > 0 && <div className="px-3 py-1.5 text-[10px] font-bold text-muted-foreground mt-2 mb-1 uppercase tracking-wider">我的订阅</div>}
        {subs.map((s: any) => (
           <button key={s.id} className={`w-full text-left px-4 py-2 text-sm transition-colors truncate ${activeTab === s.id ? 'bg-primary/10 text-primary font-medium border-l-2 border-primary' : 'hover:bg-muted/50 text-foreground'}`} onClick={() => setActiveTab(s.id)} title={s.remark || s.url}>{s.remark || s.url}</button>
        ))}
         
        {groupedNodes['local']?.length > 0 && (
          <div className="mt-2">
            <div className="px-3 py-1.5 text-[10px] font-bold text-muted-foreground mb-1 uppercase tracking-wider">手动节点</div>
            <button className={`w-full text-left px-4 py-2 text-sm transition-colors ${activeTab === 'local' ? 'bg-primary/10 text-primary font-medium border-l-2 border-primary' : 'hover:bg-muted/50 text-foreground'}`} onClick={() => setActiveTab('local')}>未分类节点</button>
          </div>
        )}
      </div>

      <div className="w-[65%] h-full overflow-y-auto p-3 bg-background flex flex-col gap-2 text-left">
         {activeTab === 'system' ? (
            <div className="flex flex-col gap-2 animate-in fade-in duration-200">
              <div 
                 onClick={() => onSelect('system', 'random_avail', '系统策略: 随机可用')}
                 className="p-3 border border-border/50 rounded-lg hover:border-primary/50 hover:bg-primary/5 cursor-pointer transition-colors"
               >
                 <div className="font-semibold text-sm text-foreground flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5" /> 随机可用</div>
                 <div className="text-xs text-muted-foreground mt-1.5 leading-relaxed">在所有测速通过并且尚未被其他 Worker 独占的闲置节点中，随机调配一个连接供映射。</div>
              </div>
              <div 
                 onClick={() => onSelect('system', 'random_low_lat', '系统策略: 随机低延迟')}
                 className="p-3 border border-border/50 rounded-lg hover:border-primary/50 hover:bg-primary/5 cursor-pointer transition-colors"
               >
                 <div className="font-semibold text-sm text-foreground flex items-center gap-1.5"><Zap className="w-3.5 h-3.5" /> 随机低延迟</div>
                 <div className="text-xs text-muted-foreground mt-1.5 leading-relaxed">由调度算法将候选池严格收束到延迟最低的前 20% 空闲节点里，并在其中择极速分配。</div>
              </div>
            </div>
         ) : (
            <div className="flex flex-col gap-2 animate-in fade-in duration-200">
              {groupedNodes[activeTab]?.length > 0 ? groupedNodes[activeTab].map((n: any) => {
                  const isBoundByWorker = workers.some((w: any) => w.proxyHost?.id === n.id && !w.isShuttingDown);
                  const isBoundInQueue = selectedInQueue.includes(n.id);
                  const isBound = isBoundByWorker || isBoundInQueue || n.flagged;
                  return (
                     <div key={n.id} onClick={() => !isBound && onSelect('node', n.id, n.name)} className={`p-2.5 border rounded-lg text-sm transition-colors flex items-center justify-between ${isBound ? 'opacity-50 bg-muted/40 cursor-not-allowed border-border/30' : 'hover:border-primary/50 hover:bg-primary/5 cursor-pointer border-border/60 shadow-minimal'}`}>
                        <div className="flex flex-col gap-1 overflow-hidden w-full">
                           <div className="flex items-center gap-1.5"><span className="truncate pr-2 font-mono leading-none pt-[1px]">{n.name}</span>{n.favorite && <Heart className="w-3.5 h-3.5 fill-red-500 text-red-500 shrink-0" />}</div>
                        </div>
                        {isBound ? <span className="text-[10px] text-destructive bg-destructive/10 px-1 rounded flex-shrink-0 font-semibold tracking-wider">{n.flagged ? '已标记剔除' : (isBoundInQueue ? '队列占用' : '已被占用')}</span> : <span className={`text-xs flex-shrink-0 font-mono shadow-sm ${n.latency < 500 ? 'text-green-500' : n.latency <= 1000 ? 'text-yellow-500' : 'text-red-500'}`}>{n.latency}ms</span>}
                     </div>
                  )
              }) : (
                 <div className="text-sm text-muted-foreground p-6 text-center border border-dashed border-border/50 rounded-lg mt-2">分类下暂无通过测速池检查的可用节点</div>
              )}
            </div>
         )}
      </div>
    </div>
  )
}

export default function WorkersPage() {
  const [workers, setWorkers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [nodes, setNodes] = useState<any[]>([]);
  const [subs, setSubs] = useState<any[]>([]);
  type BindType = 'unassigned' | 'system' | 'node';
  interface PendingInstance {
    id: string;
    bindType: BindType;
    bindValue: string;
    displayLabel: string;
  }

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [spawning, setSpawning] = useState(false);
  const [pendingInstances, setPendingInstances] = useState<PendingInstance[]>([]);
  const [openPopoverId, setOpenPopoverId] = useState<string | null>(null);
  
  const workersRef = useRef<any[]>([]);
  useEffect(() => { workersRef.current = workers; }, [workers]);

  const reasonLabels: Record<string, string> = {
    init_failure: '初始化失败',
    page_setup_failure: '页面预热失败',
    proxy_failure: '代理初始化失败',
    warmup_failure: '预热重启失败',
    execute_failure: '打码执行失败',
    business_error: '业务验证失败',
    post_task_recycle: '任务后指纹轮换',
    manual_restart: '手动重启',
  };

  const fetchWorkers = async () => {
    try {
      const res = await fetch('/worker-api/workers', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem("admin_token")}` }
      });
      if (res.ok) {
        setWorkers(await res.json());
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    const initSyncLoad = async () => {
      try {
        const [wRes, nRes, sRes] = await Promise.all([
          fetch('/worker-api/workers', { headers: { 'Authorization': `Bearer ${localStorage.getItem("admin_token")}` } }),
          fetch('/worker-api/proxies/nodes', { headers: { 'Authorization': `Bearer ${localStorage.getItem("admin_token")}` } }),
          fetch('/worker-api/proxies/subs', { headers: { 'Authorization': `Bearer ${localStorage.getItem("admin_token")}` } })
        ]);
        
        if (wRes.status === 401) {
          window.location.href = "/login";
          return;
        }
        
        const [wData, nData, sData] = await Promise.all([
          wRes.ok ? wRes.json() : [],
          nRes.ok ? nRes.json() : [],
          sRes.ok ? sRes.json() : []
        ]);

        setWorkers(Array.isArray(wData) ? wData : []);
        setNodes(Array.isArray(nData) ? nData : []);
        setSubs(Array.isArray(sData) ? sData : []);
      } catch (e) {
        console.error('Failed to load initial data:', e);
      } finally {
        setLoading(false);
      }
    };
    initSyncLoad();
    const interval = setInterval(fetchWorkers, 3000);
    const latencyPoll = setInterval(() => refreshActiveLatencies(false), 600 * 1000);
    return () => { clearInterval(interval); clearInterval(latencyPoll); };
  }, []);

  const refreshActiveLatencies = async (manual = false) => {
    const currentWorkers = workersRef.current;
    const assignedIds = Array.from(new Set(currentWorkers.map(w => w.proxyHost?.id).filter(Boolean)));
    if (assignedIds.length === 0) {
      if (manual) toast.info("当前没有运行中的活动实例可供探测", { id: 'ping' });
      return;
    }
    
    if (manual) toast.info(`正在探测 ${assignedIds.length} 个实例的主机背板延迟...`, { id: 'ping' });
    
    let activePings = 0;
    let completed = 0;
    const queue = [...assignedIds];
    const maxConcurrency = 5;

    await new Promise<void>((resolve) => {
      const dispatch = () => {
        if (queue.length === 0 && activePings === 0) return resolve();
        while (activePings < maxConcurrency && queue.length > 0) {
          activePings++;
          const nId = queue.shift()!;
          fetch(`/worker-api/proxies/nodes/${nId}/test`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${localStorage.getItem("admin_token")}` }
          }).then(res => res.json()).then(data => {
            if (data.result && data.result.latency !== undefined) {
               setNodes(prev => prev.map(n => n.id === nId ? { ...n, latency: data.result.latency } : n));
            }
          }).finally(() => {
            activePings--;
            completed++;
            dispatch();
          });
        }
      };
      dispatch();
    });

    if (manual) toast.success(`并发探测完毕！共更新检测了 ${completed} 条链路数据。`, { id: 'ping' });
  };



  const { activeNodes, groupedNodes } = useMemo(() => {
    const valid = nodes.filter(n => n.latency !== undefined && n.latency !== -1).sort((a,b) => a.latency - b.latency);
    const grouped: Record<string, any[]> = {};
    
    // Setup grouping buckets
    subs.forEach(s => { grouped[s.id] = []; });
    grouped['local'] = []; // fallback for manual nodes without a subscription

    valid.forEach(n => {
      if (n.subId && grouped[n.subId]) {
        grouped[n.subId].push(n);
      } else {
        grouped['local'].push(n);
      }
    });

    return { activeNodes: valid, groupedNodes: grouped };
  }, [nodes, subs]);

  useEffect(() => {
    if (isAddOpen) {
      setPendingInstances([{ id: Math.random().toString(36).substr(2, 9), bindType: 'system', bindValue: 'random_avail', displayLabel: '系统策略: 随机可用' }]);
      setOpenPopoverId(null);
    }
  }, [isAddOpen]);

  const addPendingInstance = () => {
    setPendingInstances(prev => [...prev, { id: Math.random().toString(36).substr(2, 9), bindType: 'system', bindValue: 'random_avail', displayLabel: '系统策略: 随机可用' }]);
  };
  const removePendingInstance = (id: string) => {
    setPendingInstances(prev => prev.filter(p => p.id !== id));
  };
  const updatePendingInstance = (id: string, updates: Partial<PendingInstance>) => {
    setPendingInstances(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
    setOpenPopoverId(null); // auto close proxy dropdown explicitly when selection is done
  };

  const handleBatchSpawn = async () => {
    const validQueue = pendingInstances.filter(p => p.bindType !== 'unassigned');
    if (validQueue.length === 0) return toast.error("部署列表为空或存在尚未分配网络策略的实例");
    
    setSpawning(true);
    let successCount = 0;
    
    // Explicit tracking so we don't accidentally assign the exact same random lowest-latex box multiple times
    const dynamicallyAssignedIds = new Set<string>();
    
    const getUnbound = () => activeNodes.filter(n => 
        !n.flagged &&
        !workers.some(w => w.proxyHost?.id === n.id && !w.isShuttingDown) && 
        !dynamicallyAssignedIds.has(n.id)
    );

    for (const inst of validQueue) {
       let targetNodeId = null;

       if (inst.bindType === 'node') {
          targetNodeId = inst.bindValue;
          if (dynamicallyAssignedIds.has(targetNodeId)) {
             toast.error(`冲突拦截！节点已被您上方的队列实例抢先占用分配: ${inst.displayLabel}`);
             continue;
          }
       } else if (inst.bindType === 'system') {
          const unbound = getUnbound();
          if (unbound.length === 0) {
             toast.error("池内没有足够的空闲节点供系统级策略再分配！跳过部署...");
             continue;
          }
          if (inst.bindValue === 'random_avail') {
             // pick totally random
             const randIdx = Math.floor(Math.random() * unbound.length);
             targetNodeId = unbound[randIdx].id;
          } else if (inst.bindValue === 'random_low_lat') {
             // bound to top 20% tier of performance latencies (min 1 top box available)
             const limit = Math.max(1, Math.ceil(unbound.length * 0.2));
             const randIdx = Math.floor(Math.random() * limit);
             targetNodeId = unbound[randIdx].id;
          }
       }
       
       if (targetNodeId) {
          dynamicallyAssignedIds.add(targetNodeId);
          try {
            const res = await fetch('/worker-api/workers', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${localStorage.getItem("admin_token")}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ nodeId: targetNodeId })
            });
            if (!res.ok) throw new Error((await res.json()).detail);
            successCount++;
          } catch(e: any) {
            toast.error(`部分实例拉起失败: ${e.message}`);
          }
       }
    }
    
    setSpawning(false);
    if (successCount > 0) {
       fetchWorkers();
       if (successCount === validQueue.length) {
         toast.success(`一键装载完毕！${successCount} 台实例全部进入战斗序列`);
       } else {
         toast.success(`批量执行结束，成功装载并映射 ${successCount} 台`);
       }
       setIsAddOpen(false);
    }
  };

  const killWorker = async (id: string, e: any) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/worker-api/workers/${id}`, {
        method: "DELETE",
        headers: { 'Authorization': `Bearer ${localStorage.getItem("admin_token")}` }
      });
      if (!res.ok) throw new Error("无法停止实例");
      fetchWorkers();
      toast.success(`Worker-${id} 已停止`);
    } catch(err: any) {
      toast.error(err.message);
    }
  };

  const restartWorker = async (id: string, e: any) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/worker-api/workers/${id}/restart`, {
        method: "POST",
        headers: { 'Authorization': `Bearer ${localStorage.getItem("admin_token")}` }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "无法重启实例");
      fetchWorkers();
      toast.success(`Worker-${id} 已进入手动重启流程`);
    } catch(err: any) {
      toast.error(err.message);
    }
  };

  const toggleNodeFlag = async (nodeId: string, currentFlag: boolean, e: any) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/worker-api/proxies/nodes/${nodeId}`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${localStorage.getItem("admin_token")}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ flagged: !currentFlag, favorite: false })
      });
      if (res.ok) {
        const { node } = await res.json();
        setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, flagged: node.flagged, favorite: node.favorite } : n));
        toast.info(node.flagged ? "已将该节点标记拉黑弃用" : "已恢复节点状态");
      }
    } catch(err: any) {
      toast.error(`标记操作失败，${err.message}`);
    }
  };

  const toggleNodeFavorite = async (nodeId: string, currentFav: boolean, e: any) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/worker-api/proxies/nodes/${nodeId}`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${localStorage.getItem("admin_token")}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ favorite: !currentFav, flagged: false })
      });
      if (res.ok) {
        const { node } = await res.json();
        setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, flagged: node.flagged, favorite: node.favorite } : n));
        toast.success(node.favorite ? "已加入最爱" : "已取消最爱");
      }
    } catch(err: any) {
      toast.error(`操作失败，${err.message}`);
    }
  };

  return (
    <div className="flex-1 w-full space-y-4 p-4 md:p-6 overflow-y-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Main Header Row */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-bold tracking-tight">实例集群</h2>
          <p className="text-muted-foreground">管理并监控后端浏览器自动化实例，查看指纹状态与代理分配情况。</p>
        </div>
            
            <div className="ml-auto flex items-center gap-3">
               <Button onClick={() => refreshActiveLatencies(true)} variant="outline" className="h-9 px-3 text-muted-foreground hover:text-foreground shadow-sm bg-background transition-all">
                 <Zap className="w-4 h-4 mr-2 text-primary opacity-80" /> 测试连通性
               </Button>
               <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                <DialogTrigger className="inline-flex items-center justify-center rounded-md text-sm font-semibold h-9 px-4 bg-foreground hover:opacity-90 text-background transition-colors shadow-minimal">
                  <Plus className="mr-2 h-4 w-4 stroke-[3px]" /> 新建实例
                </DialogTrigger>
            <DialogContent className="sm:max-w-3xl bg-background border-border shadow-middle text-foreground rounded-xl flex flex-col max-h-[85vh]">
              <DialogHeader className="shrink-0">
                <DialogTitle className="text-lg font-semibold flex items-center gap-2"><Server className="w-4 h-4"/> 批量部署 Worker 实例</DialogTitle>
                <DialogDescription className="text-muted-foreground font-medium">
                  将多个运行实例加入配置队列，并为每个实例分别派生独立的指纹引擎及 IP 自动分配策略。
                </DialogDescription>
              </DialogHeader>

              <div className="flex flex-col gap-4 py-4 overflow-y-auto pl-1 pr-2 flex-1">
                {pendingInstances.map((inst, index) => (
                  <div key={inst.id} className={`flex items-center justify-between p-4 border rounded-xl transition-colors shadow-sm ${inst.bindType === 'unassigned' ? 'bg-secondary/20 border-dashed border-muted-foreground/30' : 'bg-card border-border/60'}`}>
                    <div className="flex items-center gap-3">
                       <div className="bg-primary/10 text-primary w-7 h-7 rounded flex items-center justify-center font-bold text-sm shadow-[0_0_8px_rgba(var(--primary),0.1)]">{index + 1}</div>
                       <div className="flex flex-col">
                         <span className={`text-sm font-semibold mb-0.5 ${inst.bindType === 'unassigned' ? 'text-muted-foreground italic' : 'text-foreground'}`}>{inst.displayLabel}</span>
                         <span className="text-[10px] text-muted-foreground uppercase font-medium">配置项模式: <span className="text-foreground tracking-wider">{inst.bindType === 'unassigned' ? '待配置' : (inst.bindType === 'system' ? '系统智能策略调配' : '直连静态固定节点')}</span></span>
                       </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <Popover open={openPopoverId === inst.id} onOpenChange={(open) => setOpenPopoverId(open ? inst.id : null)}>
                        <PopoverTrigger className={inst.bindType === 'unassigned' ? "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground shadow hover:bg-primary/90 h-8 px-3" : "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 border border-input shadow-sm h-8 px-3 bg-card hover:border-primary/40 hover:text-primary"}>
                          配置节点映射 ▾
                        </PopoverTrigger>
                        <PopoverContent className="w-[520px] p-0 flex h-[360px] overflow-hidden border-border/50 shadow-large rounded-xl" align="end" sideOffset={8}>
                          <BindSelector 
                             subs={subs} 
                             groupedNodes={groupedNodes} 
                             workers={workers}
                             selectedInQueue={pendingInstances.filter(p => p.id !== inst.id && p.bindType === 'node').map(p => p.bindValue)}
                             onSelect={(type: BindType, val: string, label: string) => updatePendingInstance(inst.id, { bindType: type, bindValue: val, displayLabel: label })}
                          />
                        </PopoverContent>
                      </Popover>
                      <Button variant="ghost" size="icon" onClick={() => removePendingInstance(inst.id)} className="h-9 w-9 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-full transition-colors">
                        <Trash2 className="w-4 h-4"/>
                      </Button>
                    </div>
                  </div>
                ))}

                <Button variant="ghost" onClick={addPendingInstance} className="w-full border border-dashed border-border/60 bg-muted/10 text-muted-foreground hover:text-foreground hover:border-primary/40 mt-1 py-7 rounded-xl transition-colors">
                  <Plus className="w-4 h-4 mr-2" /> 追加配置新 Worker 实例
                </Button>
              </div>

              <DialogFooter className="shrink-0 pt-4 border-t border-border/20 flex flex-row items-center justify-between w-full">
                <span className="text-xs text-muted-foreground pl-2">{pendingInstances.filter(p => p.bindType !== 'unassigned').length} 个就绪策略 / 共 {pendingInstances.length} 队列项</span>
                <div className="flex items-center gap-3">
                  <Button variant="ghost" onClick={() => setIsAddOpen(false)}>取消</Button>
                  <Button onClick={handleBatchSpawn} disabled={spawning || pendingInstances.length === 0} className="bg-primary hover:bg-primary/90 text-primary-foreground min-w-36 shadow-minimal px-6">
                     {spawning ? <RefreshCw className="w-4 h-4 mr-2 animate-spin"/> : <HardDrive className="w-4 h-4 mr-2" />} {spawning ? '正在异步部署...' : '立即确认部署全部'}
                  </Button>
                </div>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Grid 区域 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-12">
        {loading && workers.length === 0 ? (
          [1,2,3,4,5,6,7,8].map(idx => (
            <div key={idx} className="bg-background/50 backdrop-blur-sm shadow-minimal rounded-2xl border border-border/50 p-4 flex flex-col overflow-hidden relative">
              {/* Shimmer overlay */}
              <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-foreground/[0.03] to-transparent" />
              {/* Header skeleton */}
              <div className="flex items-center gap-3 mb-4">
                <div className="h-3 w-3 rounded-full bg-muted-foreground/15" />
                <div className="flex flex-col gap-1.5">
                  <div className="h-4 w-24 rounded bg-muted-foreground/10" />
                  <div className="h-2.5 w-16 rounded bg-muted-foreground/[0.07]" />
                </div>
              </div>
              {/* Proxy pill skeleton */}
              <div className="h-9 w-full rounded-lg bg-muted-foreground/[0.06] mb-3" />
              {/* Metrics skeleton */}
              <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="h-14 rounded-xl bg-muted-foreground/[0.06]" />
                <div className="h-14 rounded-xl bg-muted-foreground/[0.06]" />
                <div className="h-14 rounded-xl bg-muted-foreground/[0.06]" />
              </div>
              {/* Footer skeleton */}
              <div className="flex justify-between pt-4 border-t border-border/20">
                <div className="h-3 w-20 rounded bg-muted-foreground/[0.07]" />
                <div className="h-3 w-16 rounded bg-muted-foreground/[0.07]" />
              </div>
            </div>
          ))
        ) : workers.length > 0 ? workers.map((w) => {
          const isDead = w.isShuttingDown;
          const isPaused = w.isPaused;
          const total = w.stats.success + w.stats.failed;
          const successRate = total === 0 ? 100 : Math.round((w.stats.success / total) * 100);
          const pauseLabel = w.pauseReason ? (reasonLabels[w.pauseReason] || w.pauseReason) : '未知原因';
          const statusLabel = isDead ? 'Terminated' : (isPaused ? 'Paused' : (w.isFetching ? 'Processing' : 'Standby'));

          return (
            <div key={w.nodeId} className={`group relative bg-background/50 backdrop-blur-sm shadow-minimal rounded-2xl border p-4 flex flex-col hover:shadow-md transition-all duration-300 ${isDead ? 'border-destructive/20 opacity-60' : (isPaused ? 'border-yellow-500/30' : 'border-border/50 hover:border-primary/30')}`}>
              
              {/* Header */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                   <span className="relative flex h-3 w-3">
                     {!isDead && !isPaused && w.ready && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>}
                     <span className={`relative inline-flex rounded-full h-3 w-3 ${isDead ? 'bg-destructive/60' : (isPaused ? 'bg-yellow-500' : (w.ready ? 'bg-success' : 'bg-amber-400'))}`}></span>
                   </span>
                   <div className="flex flex-col">
                     <h3 className="font-semibold text-foreground text-[15px] tracking-tight leading-none mb-1">
                       Worker-{w.nodeId}
                     </h3>
                     <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                       {statusLabel}
                     </span>
                   </div>
                </div>
                {!isDead && (isPaused ? (
                  <Button variant="ghost" size="icon" onClick={(e) => restartWorker(w.nodeId, e)} className="h-8 w-8 text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors shrink-0 -mr-1 -mt-1 rounded-full" title="手动重启">
                    <RotateCcw className="w-4 h-4" />
                  </Button>
                ) : (
                  <Button variant="ghost" size="icon" onClick={(e) => killWorker(w.nodeId, e)} className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors shrink-0 -mr-1 -mt-1 rounded-full" title="停止实例">
                    <PowerOff className="w-4 h-4" />
                  </Button>
                ))}
              </div>

              {isPaused && (
                <div className="mb-3 rounded-lg border border-yellow-500/20 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-700 dark:text-yellow-300">
                  <div className="font-semibold">已暂停，等待手动重启</div>
                  <div className="mt-1">原因: {pauseLabel}</div>
                  <div className="mt-1">非打码异常累计: {w.nonSolveFailureCount}/10</div>
                  {w.lastErrorMessage && <div className="mt-1 break-all text-[11px] opacity-90">{w.lastErrorMessage}</div>}
                </div>
              )}

              {/* Proxy Info Pill */}
              <div className="flex flex-col gap-1 text-xs font-medium text-foreground bg-secondary/30 px-2.5 py-2 rounded-lg border border-border/30 w-full mb-3 transition-colors group-hover:bg-secondary/60">
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-2 overflow-hidden w-full pr-2">
                    <Zap className={`w-3.5 h-3.5 shrink-0 ${w.isFetching ? 'text-primary animate-pulse' : 'text-muted-foreground'}`}/>
                    <span className="truncate leading-none pt-[1px]">{w.isSubProxy ? w.proxyHost.name : (w.proxyHost || "直连模式")}</span>
                  </div>
                  {(() => {
                    if (!w.proxyHost?.id) return null;
                    const matchNode = nodes.find(n => n.id === w.proxyHost.id);
                    if (!matchNode) return null;
                    
                    return (
                      <div className="flex items-center gap-2 shrink-0">
                        {matchNode.latency !== -1 && matchNode.latency !== undefined ? (
                           <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${matchNode.latency < 500 ? 'text-green-500 bg-green-500/10 border-green-500/20 shadow-[0_0_8px_rgba(34,197,94,0.1)]' : matchNode.latency <= 1000 ? 'text-yellow-500 bg-yellow-500/10 border-yellow-500/20 shadow-[0_0_8px_rgba(234,179,8,0.1)]' : 'text-red-500 bg-red-500/10 border-red-500/20 shadow-[0_0_8px_rgba(239,68,68,0.1)]'}`}>{matchNode.latency}ms</span>
                        ) : (
                           <span className="text-[10px] text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded ml-2 whitespace-nowrap">测速中</span>
                        )}
                        <Button 
                           variant="ghost" 
                           size="icon" 
                           onClick={(e) => toggleNodeFavorite(matchNode.id, matchNode.favorite, e)} 
                           className={`h-5 w-5 transition-colors rounded-full shrink-0 ${matchNode.favorite ? 'text-red-500 hover:bg-red-500/10' : 'text-muted-foreground hover:bg-muted-foreground/10 hover:text-foreground'}`}
                           title={matchNode.favorite ? "取消最爱" : "设为最爱"}
                        >
                           <Heart className={`w-3.5 ${matchNode.favorite ? 'fill-current' : ''}`} />
                        </Button>
                        <Button 
                           variant="ghost" 
                           size="icon" 
                           onClick={(e) => toggleNodeFlag(matchNode.id, matchNode.flagged, e)} 
                           className={`h-5 w-5 transition-colors rounded-full shrink-0 ${matchNode.flagged ? 'text-destructive bg-destructive/10 hover:bg-destructive/20' : 'text-muted-foreground hover:bg-muted-foreground/10 hover:text-foreground'}`}
                           title={matchNode.flagged ? "取消弃用标记" : "标记为拉黑弃用"}
                        >
                           {matchNode.flagged ? <FlagOff className="w-3" /> : <Flag className="w-3" />}
                        </Button>
                      </div>
                    );
                  })()}
                </div>
                {(() => {
                   if (!w.proxyHost?.id) return null;
                   const matchNode = nodes.find(n => n.id === w.proxyHost.id);
                   if (!matchNode) return null;
                   const matchSub = subs.find(s => s.id === matchNode.subId);
                   return (
                     <div className="flex items-center gap-1.5 mt-1 text-[10px] text-muted-foreground border-t border-border/40 pt-1.5">
                       <Server className="w-3 h-3 opacity-60" />
                       <span className="truncate">{matchSub ? (matchSub.remark || matchSub.url) : '静态配置/私人节点'}</span>
                       {w.lastRestartReason && (
                         <span className="ml-auto rounded bg-background/70 px-1.5 py-0.5 text-[9px] uppercase tracking-wider">
                           {reasonLabels[w.lastRestartReason] || w.lastRestartReason}
                         </span>
                       )}
                     </div>
                   );
                })()}
              </div>

              {/* Key Metrics */}
              <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="flex flex-col rounded-xl bg-muted/20 border border-border/30 p-2 items-center justify-center transition-colors">
                  <span className="text-[9px] text-muted-foreground uppercase font-semibold tracking-wider mb-0.5">产出</span>
                  <span className="font-sans text-base font-bold text-foreground leading-none">{w.stats.generated}</span>
                </div>
                <div className="flex flex-col rounded-xl bg-muted/20 border border-border/30 p-2 items-center justify-center transition-colors">
                  <span className="text-[9px] text-muted-foreground uppercase font-semibold tracking-wider mb-0.5">成/败</span>
                  <div className="flex items-center gap-1 font-sans text-base font-bold leading-none">
                    <span className="text-green-500">{w.stats.success}</span>
                    <span className="text-muted-foreground/40 text-xs px-[1px]">/</span>
                    <span className="text-red-500">{w.stats.failed}</span>
                  </div>
                </div>
                <div className="flex flex-col rounded-xl bg-muted/20 border border-border/30 p-2 items-center justify-center transition-colors">
                  <span className="text-[9px] text-muted-foreground uppercase font-semibold tracking-wider mb-0.5">通过率</span>
                  <span className={`font-sans text-base font-bold leading-none ${successRate >= 50 ? 'text-green-500' : 'text-red-500'}`}>{successRate}%</span>
                </div>
              </div>

              {/* Footer Fingerprint */}
              {w.screen && (
                <div className="flex items-center justify-between text-[11px] font-mono text-muted-foreground mt-auto pt-3 border-t border-border/30">
                   <div className="flex items-center gap-1.5 bg-muted/30 px-2 py-1 rounded-md"><Cpu className="w-3.5 h-3.5 opacity-70"/> {w.screen.w}×{w.screen.h}</div>
                   <div className="truncate max-w-[120px] text-right px-1" title={w.userAgent}>{w.userAgent?.split(' ')[0] || "Unknown"}</div>
                </div>
              )}
            </div>
          );
        }) : (
           <div className="col-span-full h-64 flex flex-col items-center justify-center text-muted-foreground opacity-60">
             <Activity className="w-16 h-16 mb-4 opacity-50" />
             <p className="text-lg font-medium">当前没有运行中的 Worker 实例</p>
           </div>
        )}
      </div>
    </div>
  );
}

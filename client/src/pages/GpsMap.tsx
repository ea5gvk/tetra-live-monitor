import { useState, useMemo, useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useTetraWebSocket, GpsPosition } from "@/hooks/useTetraWebSocket";
import { useI18n } from "@/lib/i18n";
import { MapPin, Navigation, Satellite, Map, Mountain, Route, Clock, List } from "lucide-react";

// Fix Leaflet default icon paths broken by Vite bundling
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

type LayerType = "map" | "sat" | "topo";
type MobileView = "map" | "list";

const TILE_LAYERS: Record<LayerType, { url: string; attribution: string }> = {
  map: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
  sat: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "&copy; Esri &mdash; Source: Esri, Maxar, GeoEye, Earthstar Geographics",
  },
  topo: {
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
  },
};

const TRACK_COLORS = [
  "#22c55e", "#3b82f6", "#f59e0b", "#ec4899",
  "#a855f7", "#06b6d4", "#f97316", "#ef4444",
];

function createStationIcon(hasFix: boolean, isSelected: boolean, colorIdx: number) {
  const color = hasFix ? TRACK_COLORS[colorIdx % TRACK_COLORS.length] : "#ef4444";
  const size = isSelected ? 38 : 30;
  const half = size / 2;
  const r1 = Math.round(half * 0.45);
  const r2 = Math.round(half * 0.25);
  const h = Math.round(size * 1.375);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${h}" viewBox="0 0 ${size} ${h}">
    <path d="M${half} 0C${Math.round(half*0.45)} 0 0 ${Math.round(half*0.45)} 0 ${half}c0 ${Math.round(half*0.75)} ${half} ${Math.round(size*0.875)} ${half} ${Math.round(size*0.875)}s${half}-${Math.round(size*0.125)} ${half}-${Math.round(size*0.875)}C${size} ${Math.round(half*0.45)} ${Math.round(half*1.55)} 0 ${half} 0z"
      fill="${color}" stroke="${isSelected ? '#fff' : color}" stroke-width="${isSelected ? 2.5 : 1.5}"/>
    <circle cx="${half}" cy="${half}" r="${r1}" fill="#fff"/>
    <circle cx="${half}" cy="${half}" r="${r2}" fill="${color}"/>
  </svg>`;
  return L.divIcon({
    html: svg,
    iconSize: [size, h],
    iconAnchor: [half, h],
    popupAnchor: [0, -h],
    className: "",
  });
}

function FitBoundsOnLoad({ positions }: { positions: GpsPosition[] }) {
  const map = useMap();
  useEffect(() => {
    const fixed = positions.filter(p => p.hasFix);
    if (fixed.length === 0) return;
    if (fixed.length === 1) { map.setView([fixed[0].lat, fixed[0].lon], 13); return; }
    const bounds = L.latLngBounds(fixed.map(p => [p.lat, p.lon] as [number, number]));
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
  }, []);
  return null;
}

function FitTrack({ track }: { track: GpsPosition[] }) {
  const map = useMap();
  useEffect(() => {
    if (track.length === 0) return;
    if (track.length === 1) { map.setView([track[0].lat, track[0].lon], 14); return; }
    const bounds = L.latLngBounds(track.map(p => [p.lat, p.lon] as [number, number]));
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [60, 60], maxZoom: 15 });
  }, [track]);
  return null;
}

function MapLayerUpdater({ layer }: { layer: LayerType }) {
  const map = useMap();
  useEffect(() => { map.invalidateSize(); }, [map, layer]);
  return null;
}

function parseTs(ts: string): Date | null {
  if (!ts) return null;
  // Full ISO / RFC2822 → parse directly
  const d = new Date(ts);
  if (!isNaN(d.getTime())) return d;
  // Time-only fallback "HH:MM:SS" → attach today's date
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(ts)) {
    const today = new Date().toISOString().split("T")[0];
    const d2 = new Date(`${today}T${ts}`);
    if (!isNaN(d2.getTime())) return d2;
  }
  return null;
}

function formatAge(ts: string): string {
  const d = parseTs(ts);
  if (!d) return "?";
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 0) return "0s";
  if (diff < 60) return `${Math.round(diff)}s`;
  if (diff < 3600) return `${Math.round(diff / 60)}m`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h`;
  return `${Math.round(diff / 86400)}d`;
}

function formatTime(ts: string): string {
  const d = parseTs(ts);
  if (!d) return ts || "?";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function dirArrow(heading: number | null): string {
  if (heading === null) return "";
  const dirs = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"];
  return dirs[Math.round(heading / 45) % 8];
}

function StationSidebar({
  positions, gpsHistory, colorByIssi, selectedIssi, setSelectedIssi,
}: {
  positions: GpsPosition[];
  gpsHistory: Record<string, GpsPosition[]>;
  colorByIssi: Record<string, number>;
  selectedIssi: string | null;
  setSelectedIssi: (issi: string | null) => void;
}) {
  const { t } = useI18n();
  const selectedTrack = selectedIssi ? (gpsHistory[selectedIssi] || []) : [];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 py-2 border-b border-border flex items-center justify-between flex-shrink-0">
        <span className="text-xs font-bold tracking-widest text-primary uppercase">{t("gps_stations")}</span>
        {selectedIssi && (
          <button onClick={() => setSelectedIssi(null)}
            className="text-[10px] font-mono text-muted-foreground hover:text-foreground"
            data-testid="button-clear-selection">
            ✕ {t("gps_clear")}
          </button>
        )}
      </div>

      {positions.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 text-center px-4">
          <MapPin className="w-8 h-8 text-muted-foreground/30 mb-3" />
          <p className="text-xs font-mono text-muted-foreground">{t("gps_no_data")}</p>
          <p className="text-[10px] font-mono text-muted-foreground/50 mt-1">{t("gps_waiting")}</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="divide-y divide-border/50">
            {positions.map(pos => {
              const trackColor = TRACK_COLORS[(colorByIssi[pos.issi] ?? 0) % TRACK_COLORS.length];
              const trackLen = (gpsHistory[pos.issi] || []).length;
              return (
                <button key={pos.issi} onClick={() => setSelectedIssi(selectedIssi === pos.issi ? null : pos.issi)}
                  data-testid={`button-station-${pos.issi}`}
                  className={`w-full text-left px-3 py-2.5 transition-colors hover:bg-white/5 ${selectedIssi === pos.issi ? "bg-primary/10" : ""}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: pos.hasFix ? trackColor : "#ef4444" }} />
                      <span className="font-mono text-xs font-bold text-foreground truncate">{pos.issi}</span>
                      {pos.callsign && (
                        <span className="text-[10px] font-mono text-amber-400 truncate">{pos.callsign}</span>
                      )}
                    </div>
                    {pos.hasFix ? (
                      <div className="text-right flex-shrink-0">
                        <div className="text-[10px] font-mono" style={{ color: trackColor }}>{pos.lat.toFixed(4)}°</div>
                        <div className="text-[10px] font-mono" style={{ color: trackColor }}>{pos.lon.toFixed(4)}°</div>
                      </div>
                    ) : (
                      <div className="text-[10px] font-mono text-red-400 font-bold">NO FIX</div>
                    )}
                  </div>
                  <div className="flex items-center justify-between mt-0.5">
                    <span className="text-[10px] font-mono text-muted-foreground/50">
                      {formatAge(pos.timestamp)} ago
                      {trackLen > 1 && (
                        <span className="ml-2 text-muted-foreground/40">
                          <Route className="w-2.5 h-2.5 inline" /> {trackLen}pts
                        </span>
                      )}
                    </span>
                    {pos.hasFix && (
                      <a href={`https://maps.google.com/?q=${pos.lat},${pos.lon}`} target="_blank"
                        rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                        className="text-[10px] font-mono text-blue-400 hover:text-blue-300"
                        data-testid={`link-maps-${pos.issi}`}>
                        Maps ↗
                      </a>
                    )}
                  </div>
                  {pos.speed !== null && (
                    <div className="text-[10px] font-mono text-muted-foreground/60 mt-0.5">
                      {pos.speed} km/h {dirArrow(pos.heading)}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {selectedIssi && selectedTrack.length > 0 && (
            <div className="border-t border-border/50 mt-1">
              <div className="px-3 py-1.5 flex items-center gap-1.5">
                <Route className="w-3 h-3 text-muted-foreground" />
                <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                  {t("gps_track_history")} ({selectedTrack.length})
                </span>
              </div>
              <div className="divide-y divide-border/30 max-h-48 overflow-y-auto">
                {[...selectedTrack].reverse().map((pt, i) => (
                  <div key={i} className="px-3 py-1.5 flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Clock className="w-2.5 h-2.5 text-muted-foreground/40 flex-shrink-0 mt-0.5" />
                      <div>
                        <div className="text-[10px] font-mono text-muted-foreground/70">{formatTime(pt.timestamp)}</div>
                        <div className="text-[10px] font-mono text-muted-foreground/50">{pt.lat.toFixed(5)}°, {pt.lon.toFixed(5)}°</div>
                      </div>
                    </div>
                    {pt.speed !== null && (
                      <span className="text-[10px] font-mono text-muted-foreground/40 flex-shrink-0">
                        {pt.speed}km/h {dirArrow(pt.heading)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function GpsMap() {
  const { gpsPositions, gpsHistory } = useTetraWebSocket();
  const { t } = useI18n();
  const [layer, setLayer] = useState<LayerType>("map");
  const [selectedIssi, setSelectedIssi] = useState<string | null>(null);
  const [showNoFix, setShowNoFix] = useState(true);
  const [showAllTracks, setShowAllTracks] = useState(false);
  const [mobileView, setMobileView] = useState<MobileView>("map");

  const positions = useMemo(() => Object.values(gpsPositions), [gpsPositions]);
  const withFix = positions.filter(p => p.hasFix);
  const noFix = positions.filter(p => !p.hasFix);
  const visible = showNoFix ? positions : withFix;

  const issiList = useMemo(() => Object.keys(gpsPositions), [gpsPositions]);
  const colorByIssi = useMemo(() => {
    const map: Record<string, number> = {};
    issiList.forEach((issi, i) => { map[issi] = i; });
    return map;
  }, [issiList]);

  const selectedTrack = selectedIssi ? (gpsHistory[selectedIssi] || []) : [];
  const tileLayer = TILE_LAYERS[layer];
  const defaultCenter: [number, number] = withFix.length > 0
    ? [withFix[0].lat, withFix[0].lon]
    : [40.0, -3.7];

  const mapContent = (
    <MapContainer center={defaultCenter} zoom={withFix.length > 0 ? 12 : 6}
      style={{ height: "100%", width: "100%", background: "#0d1117" }} zoomControl={true}>
      <TileLayer url={tileLayer.url} attribution={tileLayer.attribution} />
      <MapLayerUpdater layer={layer} />

      {visible.length > 0 && withFix.length > 0 && !selectedIssi && (
        <FitBoundsOnLoad positions={visible} />
      )}

      {selectedIssi && selectedTrack.length > 0 && (
        <FitTrack track={selectedTrack} />
      )}

      {showAllTracks && Object.entries(gpsHistory).map(([issi, track]) => {
        if (track.length < 2) return null;
        const color = TRACK_COLORS[(colorByIssi[issi] ?? 0) % TRACK_COLORS.length];
        const isSelected = selectedIssi === issi;
        return (
          <Polyline key={`track-all-${issi}`}
            positions={track.map(p => [p.lat, p.lon] as [number, number])}
            pathOptions={{ color, weight: isSelected ? 3 : 1.5, opacity: isSelected ? 0.9 : 0.35 }} />
        );
      })}

      {!showAllTracks && selectedIssi && selectedTrack.length >= 2 && (
        <Polyline
          positions={selectedTrack.map(p => [p.lat, p.lon] as [number, number])}
          pathOptions={{
            color: TRACK_COLORS[(colorByIssi[selectedIssi] ?? 0) % TRACK_COLORS.length],
            weight: 3, opacity: 0.9,
          }} />
      )}

      {visible.map(pos => (
        <Marker key={pos.issi} position={[pos.lat, pos.lon]}
          icon={createStationIcon(pos.hasFix, selectedIssi === pos.issi, colorByIssi[pos.issi] ?? 0)}
          eventHandlers={{ click: () => setSelectedIssi(selectedIssi === pos.issi ? null : pos.issi) }}>
          <Popup className="leaflet-popup-tetra">
            <div style={{ fontFamily: "monospace", minWidth: 170, background: "#0d1117", color: "#e5e7eb", padding: "6px 8px", borderRadius: 4, fontSize: 12 }}>
              <div style={{ fontWeight: "bold", color: TRACK_COLORS[(colorByIssi[pos.issi] ?? 0) % TRACK_COLORS.length], marginBottom: 4 }}>
                ISSI: {pos.issi}
                {pos.callsign && <span style={{ color: "#f59e0b", marginLeft: 8 }}>{pos.callsign}</span>}
              </div>
              <div style={{ color: "#9ca3af" }}>{pos.lat.toFixed(5)}°, {pos.lon.toFixed(5)}°</div>
              {pos.speed !== null && (
                <div style={{ color: "#9ca3af" }}>{pos.speed} km/h {dirArrow(pos.heading)}</div>
              )}
              {(gpsHistory[pos.issi]?.length ?? 0) > 1 && (
                <div style={{ color: "#6b7280", fontSize: 11, marginTop: 3 }}>
                  <Route size={10} style={{ display: "inline", marginRight: 3 }} />
                  {gpsHistory[pos.issi].length} track points
                </div>
              )}
              <div style={{ color: "#6b7280", marginTop: 4 }}>{formatAge(pos.timestamp)} ago</div>
              <a href={`https://maps.google.com/?q=${pos.lat},${pos.lon}`} target="_blank"
                rel="noopener noreferrer" style={{ color: "#3b82f6", fontSize: 11, display: "block", marginTop: 4 }}>
                Google Maps ↗
              </a>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );

  return (
    <div className="flex flex-col bg-background overflow-hidden" style={{ height: "calc(100vh - 41px)" }}>

      {/* ── Stats + controls bar ── */}
      <div className="flex-shrink-0 border-b border-border bg-card">
        {/* Row 1: counters + mobile view toggle */}
        <div className="flex items-center gap-2 px-2 sm:px-3 py-1.5 flex-wrap">
          {/* Stat chips */}
          <div className="flex gap-1.5 sm:gap-3">
            <div className="flex items-center gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 border border-green-500/30 bg-green-500/5 rounded text-xs font-mono">
              <span className="text-muted-foreground uppercase tracking-wider text-[10px] sm:text-xs">{t("gps_with_fix")}</span>
              <span className="text-green-400 font-bold text-sm sm:text-base">{withFix.length}</span>
            </div>
            <div className="flex items-center gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 border border-red-500/30 bg-red-500/5 rounded text-xs font-mono">
              <span className="text-muted-foreground uppercase tracking-wider text-[10px] sm:text-xs">{t("gps_no_fix")}</span>
              <span className="text-red-400 font-bold text-sm sm:text-base">{noFix.length}</span>
            </div>
            <div className="flex items-center gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 border border-border bg-white/5 rounded text-xs font-mono">
              <span className="text-muted-foreground uppercase tracking-wider text-[10px] sm:text-xs">TOTAL</span>
              <span className="text-foreground font-bold text-sm sm:text-base">{positions.length}</span>
            </div>
          </div>

          {/* Checkboxes */}
          <div className="flex items-center gap-3 sm:gap-4 sm:ml-4">
            <label className="flex items-center gap-1 sm:gap-1.5 text-[10px] sm:text-xs font-mono text-muted-foreground cursor-pointer select-none">
              <input type="checkbox" checked={showNoFix} onChange={e => setShowNoFix(e.target.checked)}
                className="w-3 h-3 accent-primary" data-testid="checkbox-show-nofix" />
              {t("gps_show_no_fix")}
            </label>
            <label className="flex items-center gap-1 sm:gap-1.5 text-[10px] sm:text-xs font-mono text-muted-foreground cursor-pointer select-none">
              <input type="checkbox" checked={showAllTracks} onChange={e => setShowAllTracks(e.target.checked)}
                className="w-3 h-3 accent-primary" data-testid="checkbox-show-all-tracks" />
              <Route className="w-3 h-3" />
              {t("gps_all_tracks")}
            </label>
          </div>

          {/* Mobile: map/list toggle */}
          <div className="flex lg:hidden items-center gap-1 ml-auto">
            <button onClick={() => setMobileView("map")} data-testid="button-mobile-view-map"
              className={`flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded transition-colors ${
                mobileView === "map" ? "bg-primary text-primary-foreground" : "bg-white/5 text-muted-foreground border border-border"
              }`}>
              <Map className="w-3 h-3" />MAP
            </button>
            <button onClick={() => setMobileView("list")} data-testid="button-mobile-view-list"
              className={`flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded transition-colors ${
                mobileView === "list" ? "bg-primary text-primary-foreground" : "bg-white/5 text-muted-foreground border border-border"
              }`}>
              <List className="w-3 h-3" />{t("gps_stations")}
              {positions.length > 0 && <span className="ml-0.5 text-primary font-bold">{positions.length}</span>}
            </button>
          </div>

          {/* Desktop: layer toggle */}
          <div className="hidden lg:flex items-center gap-1 ml-auto">
            {(["map", "sat", "topo"] as LayerType[]).map(l => (
              <button key={l} onClick={() => setLayer(l)} data-testid={`button-map-layer-${l}`}
                className={`px-3 py-1 text-[10px] font-bold rounded uppercase tracking-wider transition-colors ${
                  layer === l
                    ? "bg-primary text-primary-foreground"
                    : "bg-white/5 text-muted-foreground border border-border hover:bg-white/10 hover:text-foreground"
                }`}>
                {l === "map" ? <><Map className="w-3 h-3 inline mr-1" />{t("gps_layer_map")}</> :
                 l === "sat" ? <><Satellite className="w-3 h-3 inline mr-1" />{t("gps_layer_sat")}</> :
                 <><Mountain className="w-3 h-3 inline mr-1" />{t("gps_layer_topo")}</>}
              </button>
            ))}
          </div>
        </div>

        {/* Row 2 (mobile only): layer toggles + station count */}
        <div className="flex lg:hidden items-center gap-1.5 px-2 pb-1.5">
          {(["map", "sat", "topo"] as LayerType[]).map(l => (
            <button key={l} onClick={() => setLayer(l)} data-testid={`button-map-layer-${l}-mobile`}
              className={`flex items-center gap-0.5 px-2 py-0.5 text-[9px] font-bold rounded uppercase tracking-wider transition-colors ${
                layer === l
                  ? "bg-primary text-primary-foreground"
                  : "bg-white/5 text-muted-foreground border border-border"
              }`}>
              {l === "map" ? <><Map className="w-2.5 h-2.5" />{t("gps_layer_map")}</> :
               l === "sat" ? <><Satellite className="w-2.5 h-2.5" />{t("gps_layer_sat")}</> :
               <><Mountain className="w-2.5 h-2.5" />{t("gps_layer_topo")}</>}
            </button>
          ))}
        </div>
      </div>

      {/* ── MOBILE: show map OR list ── */}
      <div className="flex-1 flex flex-col lg:hidden overflow-hidden">
        {mobileView === "map" ? (
          <div className="flex-1 relative">
            {mapContent}
          </div>
        ) : (
          <div className="flex-1 overflow-hidden bg-card">
            <StationSidebar
              positions={positions}
              gpsHistory={gpsHistory}
              colorByIssi={colorByIssi}
              selectedIssi={selectedIssi}
              setSelectedIssi={(issi) => { setSelectedIssi(issi); setMobileView("map"); }}
            />
          </div>
        )}
      </div>

      {/* ── DESKTOP: map + sidebar side by side ── */}
      <div className="hidden lg:flex flex-1 overflow-hidden">
        <div className="flex-1 relative">
          {mapContent}
        </div>
        <div className="w-72 flex-shrink-0 border-l border-border bg-card overflow-hidden flex flex-col">
          <StationSidebar
            positions={positions}
            gpsHistory={gpsHistory}
            colorByIssi={colorByIssi}
            selectedIssi={selectedIssi}
            setSelectedIssi={setSelectedIssi}
          />
        </div>
      </div>
    </div>
  );
}

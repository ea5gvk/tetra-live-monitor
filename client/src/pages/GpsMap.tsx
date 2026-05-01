import { useState, useMemo, useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useTetraWebSocket, GpsPosition } from "@/hooks/useTetraWebSocket";
import { useI18n } from "@/lib/i18n";
import { MapPin, Navigation, Satellite, Map, Mountain } from "lucide-react";

// Fix Leaflet default icon paths broken by Vite bundling
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

type LayerType = "map" | "sat" | "topo";

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

function createStationIcon(hasFix: boolean, isSelected: boolean) {
  const color = hasFix ? "#22c55e" : "#ef4444";
  const border = isSelected ? "#fff" : color;
  const size = isSelected ? 38 : 32;
  const half = size / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${Math.round(size * 1.375)}" viewBox="0 0 ${size} ${Math.round(size * 1.375)}">
    <path d="M${half} 0C${Math.round(half * 0.4475)} 0 0 ${Math.round(half * 0.4475)} 0 ${half}c0 ${Math.round(half * 0.75)} ${half} ${Math.round(size * 0.875)} ${half} ${Math.round(size * 0.875)}s${half}-${Math.round(size * 0.125)} ${half}-${Math.round(size * 0.875)}C${size} ${Math.round(half * 0.4475)} ${Math.round(half * 1.5525)} 0 ${half} 0z" fill="${color}" stroke="${border}" stroke-width="${isSelected ? 2.5 : 1.5}"/>
    <circle cx="${half}" cy="${half}" r="${Math.round(half * 0.4375)}" fill="#fff"/>
    <circle cx="${half}" cy="${half}" r="${Math.round(half * 0.25)}" fill="${color}"/>
  </svg>`;
  return L.divIcon({
    html: svg,
    iconSize: [size, Math.round(size * 1.375)],
    iconAnchor: [half, Math.round(size * 1.375)],
    popupAnchor: [0, -Math.round(size * 1.375)],
    className: "",
  });
}

function FitBoundsOnLoad({ positions }: { positions: GpsPosition[] }) {
  const map = useMap();
  useEffect(() => {
    const fixed = positions.filter(p => p.hasFix);
    if (fixed.length === 0) return;
    if (fixed.length === 1) {
      map.setView([fixed[0].lat, fixed[0].lon], 13);
      return;
    }
    const bounds = L.latLngBounds(fixed.map(p => [p.lat, p.lon] as [number, number]));
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
  }, []); // only on mount
  return null;
}

function MapLayerUpdater({ layer }: { layer: LayerType }) {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
  }, [map, layer]);
  return null;
}

function formatAge(ts: string): string {
  try {
    const diff = (Date.now() - new Date(ts).getTime()) / 1000;
    if (diff < 60) return `${Math.round(diff)}s`;
    if (diff < 3600) return `${Math.round(diff / 60)}m`;
    if (diff < 86400) return `${Math.round(diff / 3600)}h`;
    return `${Math.round(diff / 86400)}d`;
  } catch {
    return "?";
  }
}

function dirArrow(heading: number | null): string {
  if (heading === null) return "";
  const dirs = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"];
  return dirs[Math.round(heading / 45) % 8];
}

export default function GpsMap() {
  const { gpsPositions } = useTetraWebSocket();
  const { t } = useI18n();
  const [layer, setLayer] = useState<LayerType>("map");
  const [selectedIssi, setSelectedIssi] = useState<string | null>(null);
  const [showNoFix, setShowNoFix] = useState(true);

  const positions = useMemo(() => Object.values(gpsPositions), [gpsPositions]);
  const withFix = positions.filter(p => p.hasFix);
  const noFix = positions.filter(p => !p.hasFix);

  const visible = showNoFix ? positions : withFix;

  const tileLayer = TILE_LAYERS[layer];

  const defaultCenter: [number, number] = withFix.length > 0
    ? [withFix[0].lat, withFix[0].lon]
    : [40.0, -3.7]; // Spain default

  return (
    <div className="flex flex-col h-[calc(100vh-41px)] bg-background overflow-hidden">
      {/* Top stats bar */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-border bg-card flex-shrink-0">
        <div className="flex gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 border border-green-500/30 bg-green-500/5 rounded text-xs font-mono">
            <span className="text-muted-foreground uppercase tracking-wider">{t("gps_with_fix")}</span>
            <span className="text-green-400 font-bold text-base">{withFix.length}</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 border border-red-500/30 bg-red-500/5 rounded text-xs font-mono">
            <span className="text-muted-foreground uppercase tracking-wider">{t("gps_no_fix")}</span>
            <span className="text-red-400 font-bold text-base">{noFix.length}</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 border border-border bg-white/5 rounded text-xs font-mono">
            <span className="text-muted-foreground uppercase tracking-wider">{t("gps_total")}</span>
            <span className="text-foreground font-bold text-base">{positions.length}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 ml-4">
          <label className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showNoFix}
              onChange={e => setShowNoFix(e.target.checked)}
              className="w-3 h-3 accent-primary"
              data-testid="checkbox-show-nofix"
            />
            {t("gps_show_no_fix")}
          </label>
        </div>

        <div className="ml-auto flex items-center gap-1">
          {(["map", "sat", "topo"] as LayerType[]).map(l => (
            <button
              key={l}
              onClick={() => setLayer(l)}
              data-testid={`button-map-layer-${l}`}
              className={`px-3 py-1 text-[10px] font-bold rounded uppercase tracking-wider transition-colors ${
                layer === l
                  ? "bg-primary text-primary-foreground"
                  : "bg-white/5 text-muted-foreground border border-border hover:bg-white/10 hover:text-foreground"
              }`}
            >
              {l === "map" ? <><Map className="w-3 h-3 inline mr-1" />{t("gps_layer_map")}</> :
               l === "sat" ? <><Satellite className="w-3 h-3 inline mr-1" />{t("gps_layer_sat")}</> :
               <><Mountain className="w-3 h-3 inline mr-1" />{t("gps_layer_topo")}</>}
            </button>
          ))}
        </div>
      </div>

      {/* Main content: map + station list */}
      <div className="flex flex-1 overflow-hidden">
        {/* Map */}
        <div className="flex-1 relative">
          <MapContainer
            center={defaultCenter}
            zoom={withFix.length > 0 ? 12 : 6}
            style={{ height: "100%", width: "100%", background: "#0d1117" }}
            zoomControl={true}
          >
            <TileLayer
              url={tileLayer.url}
              attribution={tileLayer.attribution}
            />
            <MapLayerUpdater layer={layer} />
            {visible.length > 0 && withFix.length > 0 && (
              <FitBoundsOnLoad positions={visible} />
            )}
            {visible.map(pos => (
              <Marker
                key={pos.issi}
                position={[pos.lat, pos.lon]}
                icon={createStationIcon(pos.hasFix, selectedIssi === pos.issi)}
                eventHandlers={{ click: () => setSelectedIssi(pos.issi) }}
              >
                <Popup className="leaflet-popup-tetra">
                  <div style={{ fontFamily: "monospace", minWidth: 160, background: "#0d1117", color: "#e5e7eb", padding: "6px 8px", borderRadius: 4, fontSize: 12 }}>
                    <div style={{ fontWeight: "bold", color: "#22c55e", marginBottom: 4 }}>
                      ISSI: {pos.issi}
                      {pos.callsign && <span style={{ color: "#f59e0b", marginLeft: 8 }}>{pos.callsign}</span>}
                    </div>
                    <div style={{ color: "#9ca3af" }}>{pos.lat.toFixed(5)}°, {pos.lon.toFixed(5)}°</div>
                    {pos.speed !== null && (
                      <div style={{ color: "#9ca3af" }}>{pos.speed} km/h {dirArrow(pos.heading)}</div>
                    )}
                    <div style={{ color: "#6b7280", marginTop: 4 }}>{formatAge(pos.timestamp)} ago</div>
                    <a
                      href={`https://maps.google.com/?q=${pos.lat},${pos.lon}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "#3b82f6", fontSize: 11, display: "block", marginTop: 4 }}
                    >
                      Google Maps ↗
                    </a>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>

        {/* Station list */}
        <div className="w-72 flex-shrink-0 border-l border-border bg-card overflow-y-auto">
          <div className="px-3 py-2 border-b border-border">
            <span className="text-xs font-bold tracking-widest text-primary uppercase">{t("gps_stations")}</span>
          </div>
          {positions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center px-4">
              <MapPin className="w-8 h-8 text-muted-foreground/30 mb-3" />
              <p className="text-xs font-mono text-muted-foreground">{t("gps_no_data")}</p>
              <p className="text-[10px] font-mono text-muted-foreground/50 mt-1">{t("gps_waiting")}</p>
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {positions.map(pos => (
                <button
                  key={pos.issi}
                  onClick={() => setSelectedIssi(selectedIssi === pos.issi ? null : pos.issi)}
                  data-testid={`button-station-${pos.issi}`}
                  className={`w-full text-left px-3 py-2.5 transition-colors hover:bg-white/5 ${
                    selectedIssi === pos.issi ? "bg-primary/10" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`w-2 h-2 rounded-full flex-shrink-0 ${
                          pos.hasFix ? "bg-green-400" : "bg-red-400"
                        }`}
                      />
                      <span className="font-mono text-xs font-bold text-foreground truncate">
                        {pos.issi}
                      </span>
                      {pos.callsign && (
                        <span className="text-[10px] font-mono text-amber-400 truncate">
                          {pos.callsign}
                        </span>
                      )}
                    </div>
                    {pos.hasFix ? (
                      <div className="text-right flex-shrink-0">
                        <div className="text-[10px] font-mono text-green-400">
                          {pos.lat.toFixed(4)}°, {pos.lon.toFixed(4)}°
                        </div>
                        {pos.speed !== null && (
                          <div className="text-[10px] font-mono text-muted-foreground">
                            {pos.speed} km/h {dirArrow(pos.heading)}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-right flex-shrink-0">
                        <div className="text-[10px] font-mono text-red-400 font-bold">NO FIX</div>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between mt-0.5">
                    <span className="text-[10px] font-mono text-muted-foreground/50">
                      {formatAge(pos.timestamp)} ago
                    </span>
                    {pos.hasFix && (
                      <a
                        href={`https://maps.google.com/?q=${pos.lat},${pos.lon}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="text-[10px] font-mono text-blue-400 hover:text-blue-300"
                        data-testid={`link-maps-${pos.issi}`}
                      >
                        Maps ↗
                      </a>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

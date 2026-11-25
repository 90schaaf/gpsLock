import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'preact/hooks';

export interface MapCircle {
  id: string;
  lat: number;
  lng: number;
  radiusM: number;
  color: string;
  label?: string;
  draggable?: boolean;
  selected?: boolean;
  dashed?: boolean;
  /** Always show the label (e.g. numbered hunt checkpoints). */
  permanentLabel?: boolean;
}

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  color: string;
  label?: string;
  accuracy?: number;
}

export interface LeafletMapProps {
  circles?: MapCircle[];
  points?: MapPoint[];
  /** Changing this value re-fits the map to all shapes. */
  fitKey?: string;
  center?: { lat: number; lng: number };
  height?: string;
  onClick?: (p: { lat: number; lng: number }) => void;
  onCircleClick?: (id: string) => void;
  onCircleMove?: (id: string, p: { lat: number; lng: number }) => void;
}

const OSM = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

export function LeafletMap(props: LeafletMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map>();
  const layer = useRef<L.LayerGroup>();
  const handlers = useRef(props);
  handlers.current = props;

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true }).setView(
      [props.center?.lat ?? 47.3769, props.center?.lng ?? 8.5417],
      14,
    );
    L.tileLayer(OSM, { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => handlers.current.onClick?.({ lat: e.latlng.lat, lng: e.latlng.lng }));
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      m.remove();
    };
  }, []);

  // Sync shapes
  useEffect(() => {
    const g = layer.current;
    if (!g) return;
    g.clearLayers();
    for (const c of props.circles ?? []) {
      const circle = L.circle([c.lat, c.lng], {
        radius: c.radiusM,
        color: c.color,
        weight: c.selected ? 4 : 2,
        fillOpacity: c.selected ? 0.3 : 0.15,
        dashArray: c.dashed ? '6 6' : undefined,
      }).addTo(g);
      if (c.label) circle.bindTooltip(c.label, { permanent: !!c.permanentLabel, direction: c.permanentLabel ? 'center' : 'top', className: c.permanentLabel ? 'map-label' : undefined });
      circle.on('click', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        // Pages that select zones (config) get the zone; elsewhere a click inside a zone is a normal map click
        // (e.g. the demo sets the fake position there).
        if (handlers.current.onCircleClick) handlers.current.onCircleClick(c.id);
        else handlers.current.onClick?.({ lat: e.latlng.lat, lng: e.latlng.lng });
      });
      if (c.draggable) {
        const handle = L.marker([c.lat, c.lng], {
          draggable: true,
          icon: L.divIcon({ className: 'map-handle', html: `<span style="background:${c.color}"></span>`, iconSize: [22, 22] }),
        }).addTo(g);
        handle.on('drag', (e) => circle.setLatLng((e.target as L.Marker).getLatLng()));
        handle.on('dragend', (e) => {
          const p = (e.target as L.Marker).getLatLng();
          handlers.current.onCircleMove?.(c.id, { lat: p.lat, lng: p.lng });
        });
      }
    }
    for (const p of props.points ?? []) {
      if (p.accuracy) L.circle([p.lat, p.lng], { radius: p.accuracy, color: p.color, weight: 1, fillOpacity: 0.08 }).addTo(g);
      const m = L.circleMarker([p.lat, p.lng], { radius: 7, color: '#fff', weight: 2, fillColor: p.color, fillOpacity: 1 }).addTo(g);
      if (p.label) m.bindTooltip(p.label, { direction: 'top' });
    }
  }, [props.circles, props.points]);

  // Fit bounds
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const shapes: L.LatLngExpression[] = [
      ...(props.circles ?? []).flatMap((c) => {
        const b = L.latLng(c.lat, c.lng).toBounds(c.radiusM * 2);
        return [b.getNorthWest(), b.getSouthEast()];
      }),
      ...(props.points ?? []).map((p) => L.latLng(p.lat, p.lng)),
    ];
    if (shapes.length) m.fitBounds(L.latLngBounds(shapes), { padding: [24, 24], maxZoom: 16 });
    else if (props.center) m.setView([props.center.lat, props.center.lng], 14);
  }, [props.fitKey]);

  return <div ref={el} class="map" style={{ height: props.height ?? '320px' }} />;
}

export const ZONE_COLORS = {
  required: '#2ecc71',
  forbidden: '#e74c3c',
  reward: '#f1c40f',
  surprise: '#ff5fb8',
  neutral: '#3498db',
  hunt: '#9b59b6',
  me: '#7c5cff',
  last: '#6b6880',
};

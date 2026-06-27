// p4-icons.jsx — shared inline icons (stroke style matches the generator app).

function Ic({ d, size = 18, sw = 2, fill = 'none', vb = 24 }) {
  return (
    <svg width={size} height={size} viewBox={`0 0 ${vb} ${vb}`} fill={fill} stroke="currentColor"
         strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
    </svg>
  );
}

const Icons = {
  mail:   (p) => <Ic {...p} d={['M4 5h16v14H4z', 'm4 7 8 6 8-6']} />,
  lock:   (p) => <Ic {...p} d={['M6 11h12v9H6z', 'M8 11V8a4 4 0 0 1 8 0v3']} />,
  eye:    (p) => <Ic {...p} d={['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z']} />,
  eyeOff: (p) => <Ic {...p} d={['m3 3 18 18', 'M10.6 10.6a3 3 0 0 0 4.2 4.2', 'M9.4 5.2A9.7 9.7 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.8', 'M6 6.5A17 17 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 3-.5']} />,
  search: (p) => <Ic {...p} d={['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z', 'm20 20-4-4']} />,
  back:   (p) => <Ic {...p} d={['M15 5l-7 7 7 7']} />,
  plus:   (p) => <Ic {...p} d={['M12 5v14', 'M5 12h14']} sw={2.4} />,
  user:   (p) => <Ic {...p} d={['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M5 20a7 7 0 0 1 14 0']} />,
  users:  (p) => <Ic {...p} d={['M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z', 'M2 20a7 7 0 0 1 14 0', 'M16 4.5a3.5 3.5 0 0 1 0 7', 'M18 20a7 7 0 0 0-3-5.7']} />,
  logout: (p) => <Ic {...p} d={['M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4', 'M10 12h9', 'm15 8 4 4-4 4']} />,
  open:   (p) => <Ic {...p} d={['M14 4h6v6', 'M10 14 20 4', 'M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6']} size={15} />,
  copy:   (p) => <Ic {...p} d={['M9 9h10v10H9z', 'M5 15V5h10']} size={15} />,
  trash:  (p) => <Ic {...p} d={['M4 7h16', 'M9 7V5h6v2', 'M6 7l1 13h10l1-13']} size={15} />,
  dots:   (p) => <Ic {...p} d={['M5 12h.01', 'M12 12h.01', 'M19 12h.01']} sw={3} size={15} />,
  edit:   (p) => <Ic {...p} d={['M4 20h4l10-10a2 2 0 0 0-4-4L4 16v4Z', 'M13.5 6.5l4 4']} size={15} />,
  cal:    (p) => <Ic {...p} d={['M4 6h16v15H4z', 'M4 10h16', 'M8 3v4', 'M16 3v4']} size={15} />,
  upload: (p) => <Ic {...p} d={['M12 16V4', 'm7 9 5-5 5 5', 'M5 20h14']} />,
  bolt:   (p) => <Ic {...p} d={['M13 3 4 14h7l-1 7 9-11h-7l1-7Z']} />,
  cog:    (p) => <Ic {...p} d={['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M19 12a7 7 0 0 0-.1-1l2-1.6-2-3.4-2.3 1a7 7 0 0 0-1.7-1l-.4-2.5h-4l-.4 2.5a7 7 0 0 0-1.7 1l-2.3-1-2 3.4 2 1.6a7 7 0 0 0 0 2l-2 1.6 2 3.4 2.3-1a7 7 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7 7 0 0 0 1.7-1l2.3 1 2-3.4-2-1.6a7 7 0 0 0 .1-1Z']} />,
};

window.Icons = Icons;

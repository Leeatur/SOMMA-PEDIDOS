interface SommaFVLogoProps {
  /** font-size do monograma SFV em px (padrão 36) */
  size?: number;
  /** white = letras brancas para fundo escuro; dark = navy para fundo branco */
  variant?: 'white' | 'dark';
  /** exibe "Somma Força de Vendas" abaixo (padrão true) */
  showTagline?: boolean;
  className?: string;
}

export function SommaFVLogo({
  size = 36,
  variant = 'white',
  showTagline = true,
  className = '',
}: SommaFVLogoProps) {
  const mainColor   = variant === 'white' ? '#ffffff' : '#0d1f3c';
  const accentColor = '#F47C20';

  return (
    <div
      className={className}
      style={{ display: 'flex', flexDirection: 'column', gap: size * 0.1, userSelect: 'none' }}
    >
      <div
        style={{
          fontFamily: "'Plus Jakarta Sans', ui-sans-serif, sans-serif",
          fontWeight: 800,
          fontSize: size,
          lineHeight: 1,
          letterSpacing: '-0.5px',
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ color: accentColor }}>S</span>
        <span style={{ color: mainColor }}>FV</span>
      </div>

      {showTagline && (
        <div
          style={{
            fontFamily: "'Plus Jakarta Sans', ui-sans-serif, sans-serif",
            fontWeight: 700,
            fontSize: Math.round(size * 0.31),
            lineHeight: 1,
            letterSpacing: '0.04em',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ color: accentColor }}>Somma </span>
          <span style={{ color: mainColor }}>Força de Vendas</span>
        </div>
      )}
    </div>
  );
}

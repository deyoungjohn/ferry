export interface EvmChainCoinSpec {
  id: 'ethereum' | 'base' | 'arbitrum' | 'bnb' | 'arc' | 'robinhood';
  name: string;
  diskColor: number;
  emblemColor: number;
  emblemAccentColor?: number;
  viewBoxSize: number;
  emblemScale: number;
  emblemSvg: string;
}

/**
 * The six EVM chains supported on Ferry, preserving each chain's official icon
 * colors in the recessed central disk framed by a polished 24K gold outer rim.
 */
export const FERRY_EVM_CHAINS: readonly EvmChainCoinSpec[] = [
  {
    id: 'ethereum',
    name: 'Ethereum',
    diskColor: 0x627eea,
    emblemColor: 0xf4f7ff,
    viewBoxSize: 32,
    emblemScale: 0.78,
    emblemSvg: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <path d="M16 3.5L9.2 15.6L16 19.6L22.8 15.6L16 3.5Z" fill="#ffffff"/>
      <path d="M16 21.1L9.2 17.1L16 28.5L22.8 17.1L16 21.1Z" fill="#ffffff"/>
    </svg>`,
  },
  {
    id: 'base',
    name: 'Base',
    diskColor: 0x0052ff,
    emblemColor: 0xffffff,
    viewBoxSize: 200,
    emblemScale: 0.68,
    emblemSvg: `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <path d="M99.8 172C139.6 172 172 139.7 172 100C172 60.3 139.6 28 99.8 28C62.1 28 31.2 57.0 28.0 93.9H122.4V106.1H28.0C31.2 143.0 62.1 172 99.8 172Z" fill="#ffffff"/>
    </svg>`,
  },
  {
    id: 'arbitrum',
    name: 'Arbitrum',
    diskColor: 0x213147,
    emblemColor: 0xffffff,
    emblemAccentColor: 0x28a0f0,
    viewBoxSize: 200,
    emblemScale: 0.76,
    emblemSvg: `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <path fill-rule="evenodd" d="M100 18L171 59V141L100 182L29 141V59L100 18ZM100 35L44 67.5V132.5L100 165L156 132.5V67.5L100 35Z" fill="#ffffff"/>
      <path d="M94 56L56 132L73 142L102 83L116 112L101 142L118 152L134 118L109 65C105.5 57.5 97.5 54 94 56Z" fill="#ffffff"/>
      <path d="M126 83L146 125L131 135L114 99L126 83Z" fill="#28a0f0"/>
    </svg>`,
  },
  {
    id: 'bnb',
    name: 'BNB Chain',
    diskColor: 0xf3ba2f,
    emblemColor: 0x131415,
    viewBoxSize: 473,
    emblemScale: 0.82,
    emblemSvg: `<svg viewBox="0 0 473 473" xmlns="http://www.w3.org/2000/svg">
      <path d="M296.6 261.1L331.4 295.8L236.8 390.3L142.3 295.8L177.1 261.1L236.8 320.8L296.6 261.1Z" fill="#131415"/>
      <path d="M236.8 201.3L272.1 236.6L236.8 271.9L201.6 236.7L236.8 201.3Z" fill="#131415"/>
      <path d="M117.8 201.8L152.6 236.6L117.8 271.3L83 236.5L117.8 201.8Z" fill="#131415"/>
      <path d="M355.8 201.8L390.6 236.6L355.8 271.3L321 236.5L355.8 201.8Z" fill="#131415"/>
      <path d="M236.8 82.8L331.3 177.3L296.5 212.1L236.8 152.3L177.1 212L142.3 177.3L236.8 82.8Z" fill="#131415"/>
    </svg>`,
  },
  {
    id: 'arc',
    name: 'Arc',
    diskColor: 0x0b2a4a,
    emblemColor: 0xe8f1f8,
    viewBoxSize: 200,
    emblemScale: 0.72,
    emblemSvg: `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <path d="M36 167C41 96 63 34 100 34C135 34 156 88 164 166C149 156 125 149 89 149L91 127C109 127 125 129 136 132C130 85 117 57 100 57C81 57 65 98 60 167H36Z" fill="#ffffff"/>
    </svg>`,
  },
  {
    id: 'robinhood',
    name: 'Robinhood',
    diskColor: 0xc5ff00,
    emblemColor: 0x14130b,
    viewBoxSize: 200,
    emblemScale: 0.76,
    emblemSvg: `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <path d="M92 60L110 43C118 36 132 36 142 40C150 48 152 65 144 80L125 103V69C125 64 121 60 116 60H92Z" fill="#14130b"/>
      <path d="M62 126L62 96C62 90 64 85 68 81L84 67H113L72 128L62 166H52L62 126Z" fill="#14130b"/>
      <path d="M78 134L118 75V105C118 111 116 117 112 122L96 138C91 142 84 143 78 140V134Z" fill="#14130b"/>
    </svg>`,
  },
];

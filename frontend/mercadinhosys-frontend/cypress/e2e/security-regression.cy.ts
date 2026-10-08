import Quagga from '@ericblade/quagga2';

describe('Migração de segurança: UI e scanner', () => {
  it('mostra login acessível com Tailwind 4 e entrada de senha protegida', () => {
    cy.visit('/login');
    cy.contains('label', 'Usuário').should('be.visible');
    cy.get('input[type=password]').should('be.visible');
    cy.contains('button', 'Entrar no Painel').should('be.visible');
    cy.get('body').should('have.css', 'font-family').and('not.be.empty');
  });

  it('redireciona visitante da área autenticada para login', () => {
    cy.visit('/products', { onBeforeLoad(win) { win.sessionStorage.clear(); } });
    cy.location('pathname').should('eq', '/login');
    cy.get('input[type=password]').should('be.visible');
  });

  it('decodifica EAN-13 real após atualizar Sharp e Quagga', () => {
    const code = '4006381333931';
    const L = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
    const G = ['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111'];
    const R = ['1110010','1100110','1101100','1000010','1011100','1001110','1010000','1000100','1001000','1110100'];
    const parity = 'LGLLGG'; // primeiro dígito 4
    const bars = '101' + [...code.slice(1,7)].map((digit,i) => (parity[i] === 'L' ? L : G)[Number(digit)]).join('') +
      '01010' + [...code.slice(7)].map(digit => R[Number(digit)]).join('') + '101';
    cy.visit('/login');
    cy.then(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 480; canvas.height = 220;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 480, 220);
      ctx.fillStyle = 'black';
      [...bars].forEach((bit, i) => { if (bit === '1') ctx.fillRect(50+i*4, 30, 4, 160); });
      return new Cypress.Promise<string | null>((resolve) => {
        Quagga.decodeSingle({ src: canvas.toDataURL(), numOfWorkers: 0, locate: false,
          inputStream: { size: 480 }, decoder: { readers: ['ean_reader'] } }, result => resolve(result?.codeResult?.code || null));
      });
    }).should('eq', code);
  });
});

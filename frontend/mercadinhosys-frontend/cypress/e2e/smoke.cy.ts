describe('Fluxos autenticados com seed na Oracle', () => {
  it('entra pelo formulário e abre produtos, clientes, vendas e PDV', () => {
    cy.viewport(1440, 900);
    cy.visit('/login');
    cy.contains('label', 'Usuário').parent().find('input').type('admin1');
    cy.get('input[type=password]').type('admin123', { log: false });
    cy.contains('button', 'Entrar no Painel').click();
    cy.location('pathname', { timeout: 30000 }).should('eq', '/dashboard');
    for (const path of ['/products', '/customers', '/sales', '/pdv']) {
      cy.visit(path);
      cy.location('pathname', { timeout: 30000 }).should('eq', path);
      cy.get('main', { timeout: 30000 }).should('be.visible');
      cy.get('body').should('not.contain.text', 'Algo deu errado');
    }
    cy.visit('/products');
    cy.get('table:visible', { timeout: 30000 }).should('have.length.greaterThan', 0);
    cy.get('table:visible tbody tr').should('have.length.greaterThan', 0);
  });
});

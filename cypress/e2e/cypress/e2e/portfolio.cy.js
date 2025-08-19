describe('Portfolio Page', () => {
  it('should load the homepage', () => {
    cy.visit('http://localhost:3000')   // coloque a URL local ou deploy do seu portfólio
    cy.contains('Yuri')                 // verifica se o texto "Yuri" aparece
  })
})

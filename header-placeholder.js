fetch('header.html')
    .then(response => {
        if (!response.ok) {
            throw new Error('Network response was not ok ' + response.statusText);
        }
        return response.text();
    })
    .then(html => {
        document.getElementById('header-placeholder').innerHTML = html;

        const hamMenu = document.querySelector('.hamburger-menu');
        const offScreenMenu = document.querySelector('.off-screen-menu');

        hamMenu.addEventListener('click', () => {
            hamMenu.classList.toggle('active');
            offScreenMenu.classList.toggle('active');
        });
    })
    .catch(error => {
        console.error('There has been a problem with your fetch operation:', error);
    });
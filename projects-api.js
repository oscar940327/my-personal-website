const API_BASE_URL = "https://fastapi-portfolio-api.onrender.com";

async function loadProjectsFromAPI(){
    const projectsList = document.getElementById("api-projects-list");

    try{
        const response = await fetch(`${API_BASE_URL}/projects`);

        if(!response.ok){
            throw new Error("Failed to load projects");
        }

        const projects = await response.json();

        projectsList.innerHTML = "";

        projects.forEach((project) => {
            const projectCard = document.createElement("div");
            projectCard.className = "project";

            projectCard.innerHTML = `
            <div class="project-title">${project.name}</div>

            <ul class="project-introduction">
                <li>${project.description}</li>
                <li><strong>Skills: </strong>${project.skill}</li>
            </ul>
            `;

            projectsList.appendChild(projectCard);
        });
    } catch (error){
        projectsList.innerHTML = "<p>Failed to load projects. Please try again later.</p>";
        console.error(error);
    }
}

loadProjectsFromAPI();
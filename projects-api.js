// const API_BASE_URL = "https://fastapi-portfolio-api.onrender.com";
const API_BASE_URL = "http://127.0.0.1:8000";

async function loadProjectsFromAPI(){
    const projectsList = document.getElementById("api-projects-list");

    try{
        projectsList.innerHTML = "<p>Loading projects...</p>";

        const response = await fetch(`${API_BASE_URL}/projects/`);

        if(!response.ok){
            throw new Error("Failed to load projects");
        }

        const projects = await response.json();

        projectsList.innerHTML = "";

        if (projects.length === 0){
            projectsList.innerHTML = "<p>No projects available.</p>";
            return;
        }

        projects.forEach((project) => {
            const projectCard = document.createElement("div");
            projectCard.className = "project";

            projectCard.innerHTML = `
            <img src="${project.image_path}" alt="${project.image_alt}">

            <div class="project-title">${project.title}</div>

            <ul class="project-introduction">
                ${project.introductions.map((intro) => `<li>${intro}</li>`).join("")}
            </ul>

            <div class="project-btn-container">
                ${
                    project.demo_url
                    ? `<a href="${project.demo_url}" target="_blank">
                            <div class="link-btn">Demo</div>
                        </a>`
                    : ""
                }

                ${
                    project.github_url
                    ? `<a href="${project.github_url}" target="_blank">
                            <div class="link-btn">Github</div>
                        </a>`
                    : ""
                }
            </div>
            `;

            projectsList.appendChild(projectCard);
        });
    } catch (error){
        projectsList.innerHTML = "<p>Failed to load projects. Please try again later.</p>";
        console.error(error);
    }
}

loadProjectsFromAPI();
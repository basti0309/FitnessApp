document.addEventListener("DOMContentLoaded", () => {
    
    const routineList = document.getElementById("routineList")
    const addroutine = document.getElementById("add");


    /*<li class="list-group-item">
              <div class="routines">
                Push
              </div>
              <form action="index.html?x=2" method="post" enctype="multipart/form-data" > 
              <button type="button" class="btn btn-primary btn-sm">edit</button>
              </form> 
            </li> */

    addroutine.addEventListener("click", () => {
        const newRoutine = document.getElementById("newRoutine")
        if (newRoutine.value!== ""){

        const newDivElement = document.createElement("div")
        newDivElement.classList.add("routines")
        newDivElement.innerText = newRoutine.value

        const newListElement = document.createElement("li")
        newListElement.classList.add("list-group-item")
        newListElement.appendChild(newDivElement)

        routineList.prepend(newListElement)
        }

    })

})


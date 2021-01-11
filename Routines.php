<!DOCTYPE html>
<html>
    <head>
        <meta charset="utf-8">
        <meta http-equiv="X-UA-Compatible" content="IE=edge">
        <title>ERSTE SCHRITTE MIT BRACKETS</title>

        <style>
          .list-group-item:hover {
            background-color: lightgrey;
            color:blue;
          }
          .routines{
            float:left;
            padding:5px;
          } 
          ..list-group-item{
            align-items: middle;
          }  
          .list-group-item button{
            margin:5px 0px 5px 0px; 
            float: right;"
          }
          #add {
            margin-bottom:5px;
          }       
        </style>
    </head>
    
        <body>
        <form action="index.html?x=2" method="post" enctype="multipart/form-data" > 
              <input type="text" id="newRoutine">
              <button type="button" id="add" class="btn btn-primary btn-sm">Add Routine</button>
        </form> 

          <ul class="list-group" id = "routineList">
            <li class="list-group-item">
              <div class="routines">
                Push
              </div>
              <form action="index.html?x=2" method="post" enctype="multipart/form-data" > 
              <button type="button" class="btn btn-primary btn-sm">edit</button>
              </form> 
            </li>
            <li class="list-group-item">
            <div class="routines">
                Pull
              </div>
              <form action="index.html?x=2" method="post" enctype="multipart/form-data" > 
              <button type="button" class="btn btn-primary btn-sm">edit</button>
              </form> 
            </li>
            <li class="list-group-item">
            <div class="routines">
                Legs
              </div>
              <form action="index.html?x=2" method="post" enctype="multipart/form-data" > 
              <button type="button" class="btn btn-primary btn-sm">edit</button>
              </form> 
            </li>
          </ul>
          


    
        
        </body>
</html>
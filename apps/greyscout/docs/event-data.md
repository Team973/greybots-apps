
# Event Data 

* Admin users shall have the ability to set the event schedule for the team  
  * There should be a view in the admin dashboard to set all the events for the current season.  
* Static event information shall be loaded from The Blue Alliance into a database prior to an event, and updated automatically (via github actions)  
  * Teams attending the event  
  * Event ID  
  * Event name  
* Dynamic event information shall be updated upon a manual request (via the website itself) from a Lead or Admin user.  
  * Match schedules and results  
  * Current Rankings  
* The app shall automatically determine which event is being attended based on the current date and the end date of all the events in the team’s schedule.  
  * Alternatively, admin users shall have the power to set the event manually
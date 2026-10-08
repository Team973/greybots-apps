
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

## Refreshing event data ([issue #127](https://github.com/Team973/greybots-apps/issues/127))

**Account → Event Management → Refresh Event Data** (leads and admins) pulls the current event's team list and match schedule from The Blue Alliance, through the `tba-proxy` Edge Function's `refresh_event` action. The nightly job (`util/event_info.py`) applies the same team-list rule to every event.

* Teams TBA lists are added to the `Team` table (or renamed).
* A team TBA no longer lists has dropped out, and its `Team` row is deleted. Every view takes its teams from that table, so the team disappears from the app. Pick lists and the starred-teams list also ignore a saved team that's no longer at the event. Anything already scouted on the team is kept in the database, and a team already placed on a playoff alliance stays there.
* A **custom team** is a `Team` row with `custom = true`: a team added by hand that TBA doesn't list for the event. A refresh never removes it. Leads and admins add and remove them on the **Event Teams** page (`/event-teams`, linked from Account → Event Management), which also lists every team the app has for the event.
* If TBA returns no teams at all (the list isn't published yet), nothing is removed.

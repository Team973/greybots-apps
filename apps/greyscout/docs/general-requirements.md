# General Requirements

## Technologies

* The app shall be written with the Vue.js framework  
* The database of choice shall be supabase  
* TanStack Query and Pinia shall be used to maintain the offline storage in cases where data was unable to make it to supabase

## Performance

* The app shall be usable in low-internet environments  
  * If user inputs fail, they shall be stored locally and synced to the remote database upon restoration of internet connection  
    * The user shall also be able to retry data submission manually  
  * Users shall have the ability to see a queue of the data that has not successfully been submitted to the remote database  
  * The app shall notify the user if it is in offline or online mode